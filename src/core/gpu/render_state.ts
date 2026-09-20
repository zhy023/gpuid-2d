/**
 * 画布类渲染通路的公共状态。
 *
 * 同一个 render pass 内所有 pipeline 的采样数、颜色目标 blend 必须一致，
 * 所以核心与业务 pipeline 统一从这里取，避免各写一份而出现只能在运行期
 * 才发现的 "sample count mismatch / attachment incompatible" 报错。
 */

/** MSAA 采样数：4x 是 2D 图形性价比最高的一档 */
export const CANVAS_SAMPLE_COUNT = 4;

/** 标准 alpha 混合：半透明图元、文字描边都靠它 */
export const ALPHA_BLEND_STATE: GPUBlendState = {
  color: {
    srcFactor: 'src-alpha',
    dstFactor: 'one-minus-src-alpha',
    operation: 'add',
  },
  alpha: {
    srcFactor: 'one',
    dstFactor: 'one-minus-src-alpha',
    operation: 'add',
  },
};
