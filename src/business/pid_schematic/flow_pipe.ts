/**
 * 流动管线：图形基类在 P&ID 业务里的一个实现（形状是折线，外观是管身底色）。
 *
 * 图形基类只表达「打开 → 有流动动画」，这里补两块 P&ID 语义：
 *  - 静止虚线：图纸里 `dashed=1` 的管线画条纹但不随时间移动
 *  - 速度约定：交给管线着色器的 `flowSpeed` 用符号区分三态
 *    `> 0` 流动 / `< 0` 静止虚线 / `= 0` 实心默认样式
 *
 * 几何：只保留折线顶点；渲染侧按「每段一个单位方块实例」展开
 * （见 `pipe_instances.ts`），业务对象不再持有 CPU 膨胀顶点。
 */
import {
  PIPE_LINE_WIDTH_DEFAULT_PX,
  snapPipeLineWidthPx,
} from '@/business/pid_schematic/pipe_style';
import type { Point } from '@/core/geometry/polyline';
import { Graphic } from '@/core/scene/graphic';

/** 静止虚线的速度约定值（着色器按符号判定三态） */
export const PIPE_DASHED_FLOW_SPEED = -1;

export class FlowPipe extends Graphic {
  /** 是否画成虚线（图纸里的 dashed） */
  dashed = false;

  /** 交给管线着色器的流速：`> 0` 流动 / `< 0` 静止虚线 / `= 0` 实心 */
  get flowSpeed(): number {
    if (this.open) return this.animationSpeed;
    return this.dashed ? PIPE_DASHED_FLOW_SPEED : 0;
  }

  /** 虚线样式：与开关状态正交（关闭 = 静止虚线，打开 = 照常流动） */
  setDashed(dashed: boolean): this {
    if (this.dashed === dashed) return this;
    this.dashed = dashed;
    this.dirty = true;
    return this;
  }
}

/** 创建管线（示例与测试用的便捷工厂：id + 折线 + 像素粗细） */
export function createFlowPipe(
  id: number,
  points: readonly Point[],
  lineWidthPx = PIPE_LINE_WIDTH_DEFAULT_PX,
): FlowPipe {
  const pipe = new FlowPipe({ id });
  pipe.polyline(points, snapPipeLineWidthPx(lineWidthPx));
  return pipe;
}
