/**
 * 管线能力层：流动状态——开关 + 动画速度 + 沿自身的相位里程。
 *
 * 与「图形的选中能力」（`SelectableGraphic`）并列、互斥：管线不参与选中，只管流动。
 * 具体怎么把流动画出来（流动条纹、静止虚线…）由上层着色器与业务决定，
 * 这一层只提供状态与推进相位的入口。
 */
import { DataGraphic, type DataGraphicOptions } from '@/core/scene/graphic/data';
import type { Point } from '@/core/geometry/polyline';

export interface FlowGraphicOptions<TData = unknown> extends DataGraphicOptions<TData> {
  /** 开关状态，默认打开 */
  open?: boolean;
  /** 打开时的动画速度倍率（0 表示不流动） */
  animationSpeed?: number;
}

export class FlowGraphic<TData = unknown> extends DataGraphic<TData> {
  /** 流动开关：关闭 = 静止（默认样式或静止虚线，由上层解释） */
  open: boolean;
  /** 打开时的速度倍率 */
  animationSpeed: number;
  /** 沿自身的相位里程（世界单位）：每个顶点沿流向推进 */
  flowOffset: number;

  constructor(options: FlowGraphicOptions<TData>) {
    super(options);
    this.open = options.open ?? true;
    this.animationSpeed = options.animationSpeed ?? 1;
    this.flowOffset = 0;
  }

  /** 是否正在流动：打开且速度非 0 */
  get animated(): boolean {
    return this.open && this.animationSpeed !== 0;
  }

  /** 交给渲染的流动速度：关闭时为 0（静止的外观） */
  get currentAnimationSpeed(): number {
    return this.animated ? this.animationSpeed : 0;
  }

  /** 设置流动开关 */
  setOpen(open: boolean): this {
    if (this.open === open) return this;
    this.open = open;
    this.dirty = true;
    return this;
  }

  toggleOpen(): this {
    return this.setOpen(!this.open);
  }

  setAnimationSpeed(speed: number): this {
    if (this.animationSpeed === speed) return this;
    this.animationSpeed = speed;
    this.dirty = true;
    return this;
  }

  /** 推进流动相位（世界单位），按沿管线的里程调用 */
  advanceFlow(distance: number): this {
    this.flowOffset += distance;
    return this;
  }

  /** 折线顶点一变，相位从头开始，避免条纹跳变 */
  override setPoints(points: readonly Point[]): this {
    super.setPoints(points);
    return this.resetFlow();
  }

  /** 重置相位（几何变更后调用，避免条纹跳变） */
  resetFlow(): this {
    this.flowOffset = 0;
    return this;
  }
}
