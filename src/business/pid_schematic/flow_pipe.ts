/**
 * 流动管线：管线基类在 P&ID 业务里的一个实现。
 *
 * 管线基类只表达「打开 → 有流动动画」，这里补两块 P&ID 语义：
 *  - 静止虚线：图纸里 `dashed=1` 的管线画条纹但不随时间移动
 *  - 速度约定：交给管线着色器的 `flowSpeed` 用符号区分三态
 *    `> 0` 流动 / `< 0` 静止虚线 / `= 0` 实心默认样式
 */
import {
  PIPE_LINE_WIDTH_DEFAULT_PX,
  snapPipeLineWidthPx,
} from '@/business/pid_schematic/pipe_style';
import { expandPolyline, type ExpandResult, type Point } from '@/core/geometry/polyline';
import { PolylinePipe } from '@/core/graphic/polyline_pipe';

/** 静止虚线的速度约定值（着色器按符号判定三态） */
export const PIPE_DASHED_FLOW_SPEED = -1;

export class FlowPipe extends PolylinePipe {
  /** 膨胀几何缓存：按屏幕像素粗细折算成世界宽度后展开的三角带 */
  geoCache: ExpandResult | null = null;

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

  /** 按相机缩放重建膨胀几何缓存（管宽以屏幕像素定义，与缩放无关） */
  rebuildGeometry(pixelsPerWorldUnit = 1): void {
    const worldWidth = this.lineWidthPx / Math.max(pixelsPerWorldUnit, 1e-6);
    this.geoCache = expandPolyline(this.points, worldWidth);
  }
}

/** 创建管线（示例与测试用的便捷工厂：id + 折线 + 像素粗细） */
export function createFlowPipe(
  id: number,
  points: readonly Point[],
  lineWidthPx = PIPE_LINE_WIDTH_DEFAULT_PX,
): FlowPipe {
  const pipe = new FlowPipe({ id, points, lineWidthPx: snapPipeLineWidthPx(lineWidthPx) });
  pipe.rebuildGeometry();
  return pipe;
}
