/**
 * 流动管线：图形基类在 P&ID 业务里的一个实现（形状是折线，外观是管身底色）。
 *
 * 图形基类只表达「打开 → 有流动动画」，这里补两块 P&ID 语义：
 *  - 静止虚线：图纸里 `dashed=1` 的管线画条纹但不随时间移动
 *  - 速度约定：交给管线着色器的 `flowSpeed` 用符号区分三态
 *    `> 0` 流动 / `< 0` 静止虚线 / `= 0` 实心默认样式
 *
 * 几何：只保留折线顶点；渲染侧按「每段一个单位方块实例」展开（见 `pipe_instances.ts`）。
 */
import { PIPE_LINE_WIDTH_DEFAULT_PX } from '@/business/pid_schematic/pipe_style';
import type { Point } from '@/core/geometry/polyline';
import { FlowGraphic } from '@/core/scene/capability/flow';

/** 静止虚线的速度约定值（着色器按符号判定三态） */
export const PIPE_DASHED_FLOW_SPEED = -1;

/** 流动管线：管线能力层（`FlowGraphic`）的业务实现——折线形状 + 流动三态 */
export class FlowPipe<TData = unknown> extends FlowGraphic<TData> {
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
export function createFlowPipe<TData = unknown>(
  id: number,
  points: readonly Point[],
  lineWidthPx = PIPE_LINE_WIDTH_DEFAULT_PX,
): FlowPipe<TData> {
  const pipe = new FlowPipe<TData>({ id });
  /* 粗细以数据为准：不做档位吸附（图纸 XML 里 strokeWidth 是多少就画多少） */
  pipe.polyline(points, lineWidthPx);
  return pipe;
}
