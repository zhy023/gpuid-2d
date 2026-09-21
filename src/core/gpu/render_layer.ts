/**
 * 绘制顺序契约。
 *
 * 同一个 render pass 内按层序提交：数值越大越后画、越压在上层。
 * 实际提交顺序：`drawUnderlay`（管线等底层）→ 核心实例批次（设备填充）→ 贴图批次（符号/位号/文字）。
 * 业务侧把自己的一次绘制注册成对应层，后续新增的高亮、标注直接插进对应层，不必改渲染循环。
 */

export const RENDER_LAYER = {
  /** 基础实例批次（图元、设备实例等由 Renderer2D 一次性提交） */
  instance: 0,
  /** 管线 */
  pipe: 10,
  /** 设备符号（阀门、泵、仪表） */
  device: 20,
  /** 选中高亮、标注、文字等覆盖层 */
  overlay: 30,
} as const;

export type RenderLayerId = (typeof RENDER_LAYER)[keyof typeof RENDER_LAYER];

/** 一次覆盖层绘制：按 layer 升序执行 */
export interface RenderLayerDraw {
  layer: RenderLayerId;
  draw: (pass: GPURenderPassEncoder) => void;
}

/** 稳定排序：同层保持注册顺序 */
export function sortRenderLayerDraws(draws: readonly RenderLayerDraw[]): RenderLayerDraw[] {
  return [...draws].sort((a, b) => a.layer - b.layer);
}
