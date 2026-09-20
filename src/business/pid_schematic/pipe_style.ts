/**
 * 管线绘制规格：粗细以「屏幕像素」为单位，与相机缩放无关。
 *
 * 世界宽度 = 像素宽度 / 相机 pixelsPerWorldUnit（正交相机下 1 世界单位 = scale 像素），
 * 提交绘制时用 pipeLineWidthToWorld 现算，因此放大缩小后屏幕粗细恒定。
 * 粗细按档位取值：最小 2px，步长 2px，即 2 / 4 / 6 / 8 / 10。
 */
export const PIPE_LINE_WIDTH_MIN_PX = 2;
export const PIPE_LINE_WIDTH_MAX_PX = 10;
export const PIPE_LINE_WIDTH_STEP_PX = 2;
export const PIPE_LINE_WIDTH_DEFAULT_PX = PIPE_LINE_WIDTH_MIN_PX;

/** 全部可选档位（UI 下拉、示例数据取随机宽度都用它） */
export const PIPE_LINE_WIDTH_STEPS: readonly number[] = Array.from(
  {
    length:
      Math.round((PIPE_LINE_WIDTH_MAX_PX - PIPE_LINE_WIDTH_MIN_PX) / PIPE_LINE_WIDTH_STEP_PX) + 1,
  },
  (_, index) => PIPE_LINE_WIDTH_MIN_PX + index * PIPE_LINE_WIDTH_STEP_PX,
);

/**
 * 把任意粗细规整到档位：先夹到 2~10px，再按 2px 步长取最近档，
 * 非法值（NaN / Infinity）回落到最小档
 */
export function snapPipeLineWidthPx(lineWidthPx: number): number {
  if (!Number.isFinite(lineWidthPx)) return PIPE_LINE_WIDTH_DEFAULT_PX;

  const clamped = Math.min(PIPE_LINE_WIDTH_MAX_PX, Math.max(PIPE_LINE_WIDTH_MIN_PX, lineWidthPx));
  const stepped =
    Math.round((clamped - PIPE_LINE_WIDTH_MIN_PX) / PIPE_LINE_WIDTH_STEP_PX) *
      PIPE_LINE_WIDTH_STEP_PX +
    PIPE_LINE_WIDTH_MIN_PX;

  return Math.min(PIPE_LINE_WIDTH_MAX_PX, Math.max(PIPE_LINE_WIDTH_MIN_PX, stepped));
}

/** 像素宽度 → 世界宽度 */
export function pipeLineWidthToWorld(lineWidthPx: number, pixelsPerWorldUnit: number): number {
  return snapPipeLineWidthPx(lineWidthPx) / Math.max(pixelsPerWorldUnit, 1e-6);
}

/**
 * 流动条纹：三种粗细、任意缩放下观感一致——只有管线粗细在变，条纹本身不跟着变。
 * 周期与速度都以屏幕像素定义，提交绘制时按当前缩放折算成世界单位。
 */
export const PIPE_FLOW_PERIOD_PX = 24;
export const PIPE_FLOW_CYCLES_PER_SEC = 1;
/** 条带在一个周期里占的比例（其余为管身底色） */
export const PIPE_FLOW_DASH_DUTY = 0.45;
