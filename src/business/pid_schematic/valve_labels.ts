/**
 * 阀门位号（标签）：属于业务表现——显示什么文字、什么颜色、摆在符号的什么位置。
 * 排版本身交给 core 的文字模块（layoutText），这里只给业务口径。
 */
import type { ValveItem } from '@/business/pid_schematic/types';
import type { GlyphAtlas } from '@/core/text/glyph_atlas';
import { layoutText } from '@/core/text/text_batch';
import type { RectInstance } from '@/core/types';

/** 位号文字颜色（浅蓝，压在灰色设备矩形上也可辨） */
export const VALVE_LABEL_COLOR = [0.55, 0.85, 1.0, 1] as const;
/** 位号相对阀门中心的位置（世界单位，y 向下） */
export const VALVE_LABEL_OFFSET = { x: -60, y: 100 } as const;

export interface ValveLabelOptions {
  pixelsPerWorldUnit: number;
  /** 位号文本；默认「你好 <编号后三位>」用于演示中英文混排 */
  label?: (valve: ValveItem) => string;
  offsetX?: number;
  offsetY?: number;
}

/**
 * 构建阀门位号实例（每字一个实例，一次绘制整批文字）
 * @param atlas 位号字号对应的字形图集
 * @param valves 可见阀门
 */
export function buildValveLabelInstances(
  atlas: GlyphAtlas,
  valves: readonly ValveItem[],
  options: ValveLabelOptions,
): RectInstance[] {
  const {
    pixelsPerWorldUnit,
    label = (valve: ValveItem) => `你好 ${valve.id % 1000}`,
    offsetX = VALVE_LABEL_OFFSET.x,
    offsetY = VALVE_LABEL_OFFSET.y,
  } = options;

  return valves.flatMap(
    (valve) =>
      layoutText(atlas, label(valve), {
        x: valve.tx + offsetX,
        y: valve.ty + offsetY,
        pixelsPerWorldUnit,
        color: VALVE_LABEL_COLOR,
      }).instances,
  );
}
