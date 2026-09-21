/**
 * 真实图纸的帧组装：设备图元批次 + 管线层 + 位号文字批次。
 *
 * 与 `frame.ts`（阀门示例 / 压测场景）并列：两者都只消费 `PidScene` 与 core 的能力，
 * 差别只在「这一帧要画哪些批次」。
 *
 * 绘制一律先建 `Graphic`（颜色/uv/尺寸口径都写在图形上）再统一装箱；
 * 引擎不再给图元兜底颜色，所以「图纸没给填充色」这种图元由 demo 决定补什么底色。
 */
import type { PidLabel } from '@/business/pid_schematic/drawio/to_pid_scene';
import type { IconTextureCache } from '@/business/pid_schematic/drawio/icon_textures';
import type { PidScene } from '@/business/pid_schematic/pid_scene';
import { buildValveSpriteGraphics } from '@/business/pid_schematic/valve_instances';
import { renderPipes } from '@/business/pid_schematic/pipe_manager';
import type { Camera2d } from '@/core/camera';
import { RENDER_LAYER, sortRenderLayerDraws } from '@/core/gpu/render_layer';
import type { Renderer2D } from '@/core/gpu/renderer';
import type { Texture2d } from '@/core/gpu/texture';
import { toInstances, type Graphic } from '@/core/scene/graphic/graphic';
import { SelectableGraphic } from '@/core/scene/capability/selectable';
import type { GlyphAtlas } from '@/core/text/glyph_atlas';
import type { LabelAtlasCache } from '@/demo/label_atlases';
import { layoutText } from '@/core/text/text_batch';

/**
 * demo 自己的画布底色。图纸里大量图元是白色/浅色填充，压在原来那块 0.96 的浅灰底上
 * 几乎看不见，所以换一个中性偏深的底把它们衬出来。
 */
export const DRAWIO_CLEAR_COLOR: GPUColor = { r: 0.11, g: 0.13, b: 0.16, a: 1 };

/** 图纸没给填充色时（drawio 的 fill=none）由 demo 补的底色，否则这些单元根本看不见 */
const DRAWIO_DEVICE_FILL = [1, 1, 1, 1] as const;
/** 图标按原色显示：逐实例颜色用白色，不做二次染色 */
const ICON_FILL = [1, 1, 1, 1] as const;

/**
 * 把图纸图元转成「可绘制图形」：补上 demo 的默认底色 + 尺寸口径。
 * 返回的是新对象，不改动场景里的图元本身。
 */
function toDrawableGraphics(
  devices: readonly SelectableGraphic[],
  fallbackFill: readonly [number, number, number, number],
): SelectableGraphic[] {
  return devices.map((device) =>
    new SelectableGraphic({
      id: device.id,
      x: device.x,
      y: device.y,
      width: device.width,
      height: device.height,
      rotation: device.rotation,
      selected: device.selected,
      fillColor: device.fillColor ?? fallbackFill,
      sizeUnit: device.sizeUnit,
    }).atlasUv(device.atlasUvRect),
  );
}

export interface DrawioFrameContext {
  renderer: Renderer2D;
  camera: Camera2d;
  /** 图纸图元（设备 / 管线）的空间索引 */
  scene: PidScene;
  /** 位号：文字 + 位置 + 颜色 */
  labels: readonly PidLabel[];
  /** 位号图集缓存：按字号取（缺则新建） */
  labelAtlases: LabelAtlasCache;
  /** 图元 id → 内联图标 data URL */
  icons: ReadonlyMap<number, string>;
  /** 图标纹理缓存（同一图标只加载一次） */
  iconTextures: IconTextureCache;
  /** 阀门开关两态贴图（阀门节点按开/关分组绘制，与阀门示例同一套口径） */
  valveOffTexture: Texture2d;
  valveOnTexture: Texture2d | null;
  valveSampler: GPUSampler;
}

/**
 * 渲染一帧图纸
 * @returns 本帧提交的设备数与管线数（便于冒烟观测剔除效果）
 */
export function renderDrawioFrame(ctx: DrawioFrameContext): { devices: number; pipes: number } {
  const {
    renderer,
    camera,
    scene,
    labels,
    labelAtlases,
    icons,
    iconTextures,
    valveOffTexture,
    valveOnTexture,
    valveSampler,
  } = ctx;
  const visible = scene.getVisible(camera.getViewportAABB());

  // 阀门节点（ValveGraphic：selectable 能力 + 开/关状态）：按开关态分组，各绑一张贴图
  const valveSprites = buildValveSpriteGraphics(visible.valves, {
    textureWidth: valveOffTexture.width,
    textureHeight: valveOffTexture.height,
  });

  // 设备图元分两组：带图标的按 dataURL 分组（各成一个纹理批次，原色显示），其余走基础批次
  const plainDevices = visible.devices.filter((device) => !icons.has(device.id));
  const iconGroups = new Map<string, typeof visible.devices>();

  for (const device of visible.devices) {
    const url = icons.get(device.id);
    if (!url) continue;
    const group = iconGroups.get(url);
    if (group) group.push(device);
    else iconGroups.set(url, [device]);
  }

  // 图纸没给填充色的单元补上 demo 底色，否则它们在深色底上完全看不见
  const deviceInstances = toInstances(toDrawableGraphics(plainDevices, DRAWIO_DEVICE_FILL));
  const iconBatches = [];
  for (const [url, devices] of iconGroups) {
    const texture = iconTextures.get(url);
    if (!texture) continue; // 未加载完，下一帧再画
    iconBatches.push({
      // 图标按图元自身的矩形尺寸铺满，原色显示（逐实例颜色给白）
      instances: toInstances(toDrawableGraphics(devices, ICON_FILL)),
      textureView: texture.view,
      sampler: iconTextures.sampler,
    });
  }

  // 位号：每字一个实例，整批一次绘制（字号由 label.fontSizePx 决定，这里固定用同一张图集）
  // 按字号分到各自图集，再按图集分组提交（图纸里字号通常只有两三档）
  // 位号文字是纯图形（不可选中），所以是 Graphic 而不是 SelectableGraphic
  const labelBatches = new Map<GlyphAtlas, Graphic[]>();
  for (const label of labels) {
    const atlas = labelAtlases.get(label.fontSizePx);
    const common = {
      pixelsPerWorldUnit: camera.scale,
      color: label.color,
    };
    // 先量宽再居中：drawio 的文字默认居中在图元内（label.x 存的是图元中心）
    const measured = layoutText(atlas, label.text, { ...common, x: 0, y: label.y });
    const graphics = layoutText(atlas, label.text, {
      ...common,
      x: label.x - measured.width / 2,
      y: label.y,
    }).graphics;

    const bucket = labelBatches.get(atlas);
    if (bucket) bucket.push(...graphics);
    else labelBatches.set(atlas, graphics);
  }

  const projMat = camera.getCameraProjectionMatrix();
  renderer.uploadProjectionMatrix(projMat);
  renderer.renderComposite({
    instances: deviceInstances,
    extraBatches: [
      // 阀门节点：关闭态 / 开启态各一批（阀门贴图与阀门示例用的是同一套）
      {
        instances: toInstances(valveSprites.closed, camera.scale),
        textureView: valveOffTexture.view,
        sampler: valveSampler,
      },
      {
        instances: toInstances(valveSprites.open, camera.scale),
        textureView: (valveOnTexture ?? valveOffTexture).view,
        sampler: valveSampler,
      },
      ...iconBatches,
      ...[...labelBatches].map(([atlas, graphics]) => ({
        instances: toInstances(graphics, camera.scale),
        textureView: atlas.texture.view,
        sampler: atlas.sampler,
      })),
    ],
    drawOverlay: (pass) => {
      const draws = sortRenderLayerDraws([
        {
          layer: RENDER_LAYER.pipe,
          draw: (overlayPass: GPURenderPassEncoder) =>
            renderPipes(overlayPass, projMat, visible.pipes, camera.scale),
        },
      ]);
      for (const item of draws) item.draw(pass);
    },
  });

  return { devices: visible.devices.length, pipes: visible.pipes.length };
}
