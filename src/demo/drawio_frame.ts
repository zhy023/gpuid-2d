/**
 * 真实图纸的帧组装：设备矩形批次 + 管线层 + 位号文字批次。
 *
 * 与 `frame.ts`（阀门示例 / 压测场景）并列：两者都只消费 `PidScene` 与 core 的能力，
 * 差别只在「这一帧要画哪些批次」。
 */
import type { PidLabel } from '@/business/pid_schematic/drawio/to_pid_scene';
import { toRectInstances } from '@/business/pid_schematic/device_stress_test';
import type { PidScene } from '@/business/pid_schematic/pid_scene';
import { renderPipes } from '@/business/pid_schematic/pipe_manager';
import type { Camera2d } from '@/core/camera';
import { RENDER_LAYER, sortRenderLayerDraws } from '@/core/gpu/render_layer';
import type { Renderer2D } from '@/core/gpu/renderer';
import type { GlyphAtlas } from '@/core/text/glyph_atlas';
import { layoutText } from '@/core/text/text_batch';

export interface DrawioFrameContext {
  renderer: Renderer2D;
  camera: Camera2d;
  /** 图纸图元（设备 / 管线）的空间索引 */
  scene: PidScene;
  /** 位号：文字 + 位置 + 颜色 */
  labels: readonly PidLabel[];
  /** 位号字号对应的字形图集 */
  labelAtlas: GlyphAtlas;
}

/**
 * 渲染一帧图纸
 * @returns 本帧提交的设备数与管线数（便于冒烟观测剔除效果）
 */
export function renderDrawioFrame(ctx: DrawioFrameContext): { devices: number; pipes: number } {
  const { renderer, camera, scene, labels, labelAtlas } = ctx;
  const visible = scene.getVisible(camera.getViewportAABB());

  // 设备图元 → 实例批次（几何 + 选中态）
  const rectInstances = toRectInstances(visible.devices);

  // 位号：每字一个实例，整批一次绘制（字号由 label.fontSizePx 决定，这里固定用同一张图集）
  const labelInstances = labels.flatMap(
    (label) =>
      layoutText(labelAtlas, label.text, {
        x: label.x,
        y: label.y,
        pixelsPerWorldUnit: camera.scale,
        color: label.color,
      }).instances,
  );

  const projMat = camera.getCameraProjectionMatrix();
  renderer.uploadProjectionMatrix(projMat);
  renderer.renderComposite({
    rectInstances,
    extraBatches: [
      {
        instances: labelInstances,
        textureView: labelAtlas.texture.view,
        sampler: labelAtlas.sampler,
      },
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
