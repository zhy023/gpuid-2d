/**
 * 管线绘制规格：**粗细是世界单位**（与图元、文字同一套口径，跟着相机缩放一起变）。
 *
 * 图纸坐标本身就是 px，所以 `strokeWidth = 2` 就是 2 世界单位；`pipeLineWidthWorld()` 只保证
 * 合法下限。粗细以数据为准（不吸附档位）；下面的档位只用于示例/压测数据生成，不作用于图纸。
 * 流动条纹的周期/速度仍按屏幕像素定义，在绘制时按相机缩放折算。
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
 * 管线粗细：世界单位（图纸 px = 世界单位），不做档位吸附、也不按相机缩放折算，
 * 这样缩放相机时管线粗细与图元、文字完全同步。
 */
export function pipeLineWidthWorld(lineWidthPx: number): number {
  const width = Number.isFinite(lineWidthPx) ? lineWidthPx : PIPE_LINE_WIDTH_DEFAULT_PX;
  return Math.max(width, 1);
}

/**
 * 流动条纹：周期是世界长度（与管线粗细、图元同一单位），速度按「每秒几个周期」定义，
 * 所以缩放相机时条纹与图元一起缩放，不会出现「管子变粗、条纹间距不变」的错位。
 */
/** 流动条纹一个周期的**世界长度**（与图元同一单位，跟着相机缩放） */
export const PIPE_FLOW_PERIOD_WORLD = 24;
export const PIPE_FLOW_CYCLES_PER_SEC = 1;
/** 条带在一个周期里占的比例（其余为管身底色） */
export const PIPE_FLOW_DASH_DUTY = 0.45;
