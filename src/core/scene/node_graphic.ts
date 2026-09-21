/**
 * 节点基类：矩形类图形（设备符号、图元块、图标框…）的公共抽象。
 *
 * 在图形基类的位置/大小/基本属性之上，补齐业务无关的节点外观与交互状态：
 *  - 背景：`backgroundColor`（就是逐实例颜色通道的那个颜色）
 *  - 边框：`borderColor` + `borderWidth`（宽度 0 表示不画边框）
 *  - 开关状态：`open`（阀门开闭、设备启用/停用…都归到这一位）
 *  - 鼠标 hover：`hovered`（是否高亮、怎么高亮由渲染侧决定）
 *
 * 节点默认是「中心点 + 宽高 + 旋转」的矩形，包围盒按旋转矩形算；
 * 圆形、多边形等符号可以继承后重写 `computeWorldAABB`。
 */
import { computeRotatedAABB } from '@/core/geometry/aabb';
import { Graphic, type GraphicOptions, type Rgba } from '@/core/scene/graphic';
import type { AABB } from '@/core/types';

export interface NodeGraphicOptions extends GraphicOptions {
  /** 背景色，null 表示沿用渲染默认色 */
  backgroundColor?: Rgba | null;
  borderColor?: Rgba | null;
  borderWidth?: number;
  /** 开关状态，默认打开 */
  open?: boolean;
}

export abstract class NodeGraphic extends Graphic {
  /** 背景（逐实例颜色） */
  backgroundColor: Rgba | null;
  /** 边框色与宽度（borderWidth <= 0 视为不画边框） */
  borderColor: Rgba | null;
  borderWidth: number;

  /** 开关状态：打开 / 关闭 */
  open: boolean;
  /** 鼠标是否悬停在该节点上 */
  hovered: boolean;

  constructor(options: NodeGraphicOptions) {
    super(options);
    this.backgroundColor = options.backgroundColor ?? null;
    this.borderColor = options.borderColor ?? null;
    this.borderWidth = options.borderWidth ?? 0;
    this.open = options.open ?? true;
    this.hovered = false;
  }

  /** 是否有可见边框 */
  get hasBorder(): boolean {
    return this.borderWidth > 0 && this.borderColor !== null;
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

  /** 设置开关状态（阀门开闭、设备启用/停用） */
  setOpen(open: boolean): this {
    if (this.open === open) return this;
    this.open = open;
    this.dirty = true;
    return this;
  }

  /** 取反开关状态 */
  toggleOpen(): this {
    return this.setOpen(!this.open);
  }

  setHovered(hovered: boolean): this {
    if (this.hovered === hovered) return this;
    this.hovered = hovered;
    this.dirty = true;
    return this;
  }

  /** 节点默认几何：中心点 + 宽高 + 旋转 → 旋转矩形的包围盒 */
  protected computeWorldAABB(): AABB {
    return computeRotatedAABB(this.x, this.y, this.width, this.height, this.rotation);
  }
}
