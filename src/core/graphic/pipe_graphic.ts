/**
 * 管线基类：折线类图形（管线、连线、走线…）的公共抽象。
 *
 * 位置/大小对折线没有实际意义（包围盒由 `points` 决定），但为了与图形契约一致仍然保留；
 * 与节点基类一样带背景（管身底色）、边框（描边）与开关状态，
 * 区别在于**打开状态下有流动动画**：
 *
 *  - `animationSpeed`：打开时的动画速度倍率（0 表示不流动，只画静态管身）
 *  - `flowOffset`：沿管线累计的相位里程（世界单位），保证折线拐点两侧条纹连续
 *  - `currentAnimationSpeed`：交给渲染的速度，关闭时为 0
 *
 * 动画的「跑」由渲染侧负责（着色器用统一的时间 uniform 推进），
 * 这里只描述状态与相位，避免每个图形各自持有计时器。
 */
import { calcPolylineBounds } from '@/core/geometry/polyline';
import type { Point } from '@/core/geometry/polyline';
import { Graphic, type GraphicOptions, type Rgba } from '@/core/graphic/graphic';
import type { AABB } from '@/core/types';

export interface PipeGraphicOptions extends GraphicOptions {
  points?: readonly Point[];
  /** 管线粗细：屏幕像素（不随相机缩放变化） */
  lineWidthPx?: number;
  /** 管身底色（逐实例颜色） */
  backgroundColor?: Rgba | null;
  borderColor?: Rgba | null;
  borderWidth?: number;
  /** 开关状态，默认打开 */
  open?: boolean;
  /** 打开时的动画速度倍率 */
  animationSpeed?: number;
}

export abstract class PipeGraphic extends Graphic {
  /** 折线顶点（世界坐标） */
  points: Point[];
  /** 管线粗细：屏幕像素 */
  lineWidthPx: number;

  /** 管身底色 */
  backgroundColor: Rgba | null;
  borderColor: Rgba | null;
  borderWidth: number;

  /** 开关状态：打开时管线有流动动画 */
  open: boolean;
  /** 打开时的动画速度倍率 */
  animationSpeed: number;
  /** 沿管线累计的相位里程（世界单位） */
  flowOffset: number;

  constructor(options: PipeGraphicOptions) {
    super(options);
    this.points = [...(options.points ?? [])];
    this.lineWidthPx = options.lineWidthPx ?? 2;
    this.backgroundColor = options.backgroundColor ?? null;
    this.borderColor = options.borderColor ?? null;
    this.borderWidth = options.borderWidth ?? 0;
    this.open = options.open ?? true;
    this.animationSpeed = options.animationSpeed ?? 1;
    this.flowOffset = 0;
  }

  /** 是否正在流动：打开且速度非 0 */
  get animated(): boolean {
    return this.open && this.animationSpeed !== 0;
  }

  /** 交给渲染的动画速度：关闭时为 0（静止的管身） */
  get currentAnimationSpeed(): number {
    return this.animated ? this.animationSpeed : 0;
  }

  get hasBorder(): boolean {
    return this.borderWidth > 0 && this.borderColor !== null;
  }

  /** 设置折线（几何变更 → 包围盒失效、标记 dirty） */
  setPoints(points: readonly Point[]): this {
    this.points = [...points];
    this.flowOffset = 0;
    this.invalidate();
    return this;
  }

  setLineWidthPx(lineWidthPx: number): this {
    if (this.lineWidthPx === lineWidthPx) return this;
    this.lineWidthPx = lineWidthPx;
    this.dirty = true;
    return this;
  }

  setBackground(color: Rgba | null): this {
    this.backgroundColor = color;
    this.dirty = true;
    return this;
  }

  setBorder(color: Rgba | null, width = this.borderWidth): this {
    this.borderColor = color;
    this.borderWidth = width;
    this.dirty = true;
    return this;
  }

  /** 开关状态：关闭即停止动画（下游恢复默认样式） */
  setOpen(open: boolean): this {
    if (this.open === open) return this;
    this.open = open;
    this.dirty = true;
    return this;
  }

  setAnimationSpeed(speed: number): this {
    if (this.animationSpeed === speed) return this;
    this.animationSpeed = speed;
    this.dirty = true;
    return this;
  }

  /** 推进相位（按世界里程；折线打包时逐段累加，保证条纹跨拐点连续） */
  advanceFlow(distance: number): this {
    this.flowOffset += distance;
    return this;
  }

  /** 折线的世界包围盒 */
  protected computeWorldAABB(): AABB {
    return calcPolylineBounds(this.points);
  }
}
