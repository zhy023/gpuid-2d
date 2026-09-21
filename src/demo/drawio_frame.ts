/**
 * 真实图纸的帧组装：设备矩形批次 + 管线层 + 位号文字批次。
 *
 * 与 `frame.ts`（阀门示例 / 压测场景）并列：两者都只消费 `PidScene` 与 core 的能力，
 * 差别只在「这一帧要画哪些批次」。
 */
import type { PidLabel } from '@/business/pid_schematic/drawio/to_pid_scene';
import type { IconTextureCache } from '@/business/pid_schematic/drawio/icon_textures';
import { toRectInstances } from '@/business/pid_schematic/device_stress_test';
import type { PidScene } from '@/business/pid_schematic/pid_scene';
import { renderPipes } from '@/business/pid_schematic/pipe_manager';
import type { Camera2d } from '@/core/camera';
import { RENDER_LAYER, sortRenderLayerDraws } from '@/core/gpu/render_layer';
import type { Renderer2D } from '@/core/gpu/renderer';
import type { RectInstance } from '@/core/types';
import type { GlyphAtlas } from '@/core/text/glyph_atlas';
import type { LabelAtlasCache } from '@/demo/label_atlases';
import { layoutText } from '@/core/text/text_batch';

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
}

/**
 * 渲染一帧图纸
 * @returns 本帧提交的设备数与管线数（便于冒烟观测剔除效果）
 */
export function renderDrawioFrame(ctx: DrawioFrameContext): { devices: number; pipes: number } {
  const { renderer, camera, scene, labels, labelAtlases, icons, iconTextures } = ctx;
  const visible = scene.getVisible(camera.getViewportAABB());

  // 设备图元分两组：带图标的按 dataURL 分组（各成一个纹理批次，原色显示），其余走矩形批次
  const plainDevices = visible.devices.filter((device) => !icons.has(device.id));
  const iconGroups = new Map<string, typeof visible.devices>();

  for (const device of visible.devices) {
    const url = icons.get(device.id);
    if (!url) continue;
    const group = iconGroups.get(url);
    if (group) group.push(device);
    else iconGroups.set(url, [device]);
  }

  const rectInstances = toRectInstances(plainDevices);
  const iconBatches = [];
  for (const [url, devices] of iconGroups) {
    const texture = iconTextures.get(url);
    if (!texture) continue; // 未加载完，下一帧再画
    iconBatches.push({
      // 图标按图元自身的矩形尺寸铺满（原色：colorA = 1 + 白色）
      instances: toRectInstances(devices).map((instance) => ({
        ...instance,
        colorR: 1,
        colorG: 1,
        colorB: 1,
        colorA: 1,
      })),
      textureView: texture.view,
      sampler: iconTextures.sampler,
    });
  }

  // 位号：每字一个实例，整批一次绘制（字号由 label.fontSizePx 决定，这里固定用同一张图集）
  // 按字号分到各自图集，再按图集分组提交（图纸里字号通常只有两三档）
  const labelBatches = new Map<GlyphAtlas, RectInstance[]>();
  for (const label of labels) {
    const atlas = labelAtlases.get(label.fontSizePx);
    const common = {
      pixelsPerWorldUnit: camera.scale,
      color: label.color,
    };
    // 先量宽再居中：drawio 的文字默认居中在图元内（label.x 存的是图元中心）
    const measured = layoutText(atlas, label.text, { ...common, x: 0, y: label.y });
    const instances = layoutText(atlas, label.text, {
      ...common,
      x: label.x - measured.width / 2,
      y: label.y,
    }).instances;

    const bucket = labelBatches.get(atlas);
    if (bucket) bucket.push(...instances);
    else labelBatches.set(atlas, instances);
  }

  const projMat = camera.getCameraProjectionMatrix();
  renderer.uploadProjectionMatrix(projMat);
  renderer.renderComposite({
    rectInstances,
    extraBatches: [
      ...iconBatches,
      ...[...labelBatches].map(([atlas, instances]) => ({
        instances,
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
