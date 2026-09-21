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
import { isDrawioCellData } from '@/business/pid_schematic/drawio/to_pid_scene';
import type { PidScene } from '@/business/pid_schematic/pid_scene';
import { uploadValveInstances } from '@/business/pid_schematic/valve_instances';
import { getValveResources } from '@/business/pid_schematic/valve_manager';
import { renderPipes } from '@/business/pid_schematic/pipe_manager';
import type { ValveGraphic } from '@/business/pid_schematic/valve_graphic';
import type { Camera2d } from '@/core/camera';
import { RENDER_LAYER, sortRenderLayerDraws } from '@/core/gpu/render_layer';
import type { Renderer2D } from '@/core/gpu/renderer';
import type { Texture2d } from '@/core/gpu/texture';
import { toInstances, type Graphic } from '@/core/scene/graphic/graphic';
import { SelectableGraphic } from '@/core/scene/capability/selectable';
import type { GlyphAtlas } from '@/core/text/glyph_atlas';
import type { LabelAtlasCache } from '@/demo/label_atlases';
import { layoutText } from '@/core/text/text_batch';

/** demo 自己的画布底色：淡淡的灰（图纸底），颜色由数据与 demo 决定，引擎不兜底 */
export const DRAWIO_CLEAR_COLOR: GPUColor = { r: 0.95, g: 0.955, b: 0.96, a: 1 };

/** 图标按原色显示：逐实例颜色用白色，不做二次染色 */
const ICON_FILL = [1, 1, 1, 1] as const;

/**
 * 把图纸图元转成「可绘制图形」：几何与颜色完全按图纸来
 * （fill=none / 没写就保持透明，与 SVG 导出一致），不替它补底色、也不动尺寸。
 * 返回的是新对象，不改动场景里的图元本身。
 */
function toDrawableGraphic(
  node: SelectableGraphic,
  /** 需要强制原色显示时（图标批次）传入；默认按图纸自己的填充色 */
  fillOverride?: readonly [number, number, number, number],
): SelectableGraphic {
  return new SelectableGraphic({
    id: node.id,
    x: node.x,
    y: node.y,
    width: node.width,
    height: node.height,
    rotation: node.rotation,
    selected: node.selected,
    fillColor: fillOverride ?? node.fillColor,
    sizeUnit: node.sizeUnit,
  }).atlasUv(node.atlasUvRect);
}

/**
 * 图标节点（含阀门）：按图纸 `aspect=fixed` 的约定等比缩放并居中，
 * 不把图标拉伸到单元矩形；尺寸与图像都取自图纸本身。
 */
function toIconGraphic(node: SelectableGraphic, texture: Texture2d): SelectableGraphic {
  const style = isDrawioCellData(node.data) ? node.data.style : null;
  const keepAspect = style?.aspect === 'fixed';
  const width = Math.abs(node.width);
  const height = Math.abs(node.height);
  const scale = keepAspect
    ? Math.min(width / Math.max(texture.width, 1), height / Math.max(texture.height, 1))
    : 1;
  const graphic = toDrawableGraphic(node, ICON_FILL);
  if (!keepAspect || scale <= 0) return graphic;
  return graphic.setSize(texture.width * scale, texture.height * scale);
}

export interface DrawioFrameContext {
  device: GPUDevice;
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
  /** 每帧回写可见阀门（输入层按同一数组下标解读拾取结果） */
  onVisibleValves?: (valves: readonly ValveGraphic[]) => void;
}

/**
 * 渲染一帧图纸
 * @returns 本帧提交的设备数与管线数（便于冒烟观测剔除效果）
 */
export function renderDrawioFrame(ctx: DrawioFrameContext): { devices: number; pipes: number } {
  const { renderer, device, camera, scene, labels, labelAtlases, icons, iconTextures } = ctx;
  const visible = scene.getVisible(camera.getViewportAABB());
  ctx.onVisibleValves?.(visible.valves);

  // 节点分两组：带内联图标的（图纸里的图片单元，含阀门节点）按 dataURL 分组、各成一个纹理批次，
  // 其余走基础批次。阀门在模型上是 ValveGraphic（selectable 能力），但画什么图、多大，完全看图纸。
  const nodes: SelectableGraphic[] = [...visible.devices, ...visible.valves];
  const plainDevices = visible.devices.filter((device) => !icons.has(device.id));
  const iconGroups = new Map<string, SelectableGraphic[]>();

  for (const node of nodes) {
    const url = icons.get(node.id);
    if (!url) continue;
    const group = iconGroups.get(url);
    if (group) group.push(node);
    else iconGroups.set(url, [node]);
  }

  // 颜色按图纸来：fill=none / 没写填充的单元保持透明（与 SVG 导出一致，不补白底）
  const deviceInstances = toInstances(plainDevices.map((device) => toDrawableGraphic(device)));
  const iconBatches = [];
  for (const [url, group] of iconGroups) {
    const texture = iconTextures.get(url);
    if (!texture) continue; // 未加载完，下一帧再画
    iconBatches.push({
      // 图标按图纸的 aspect=fixed 等比缩放居中，原色显示（逐实例颜色给白）
      instances: toInstances(
        group.map((node) => toIconGraphic(node, texture)),
        camera.scale,
      ),
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
  // 阀门拾取复用阀门模块自己的实例缓冲（与阀门示例同一套），这里每帧上传最新实例与投影
  const valveRes = getValveResources();
  if (valveRes) {
    uploadValveInstances(device, valveRes, projMat, visible.valves, camera.scale);
  }
  renderer.renderComposite({
    instances: deviceInstances,
    extraBatches: [
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
