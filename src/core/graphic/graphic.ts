/**
 * 图形基类：所有可绘制图形的公共抽象（引擎内核层，业务无关）。
 *
 * 只描述「一个图形在世界里是什么样」：位置、大小、旋转与基本属性；
 * 具体图形（矩形节点、折线管线…）继承它，并实现自己的 `type` 与包围盒。
 *
 * 三个约定：
 *  - 实现 `QuadTreeItem`：图形可以直接放进 `QuadTreeStore`，视口剔除与拾取不用适配层
 *  - 口径与实例化渲染契约一致：位置 = 中心点、大小 = 宽高、旋转 = 弧度（逆时针为正）
 *  - 几何/状态一变就打 `dirty`，并让缓存的世界包围盒失效；渲染侧据此决定是否重建实例
 */
import type { AABB, QuadItem } from '@/core/types';

/** 逐实例颜色 (r, g, b, a)，分量取值 0~1 */
export type Rgba = readonly [number, number, number, number];

/** 图形类型：与实例化渲染契约（`QuadItem.type`）保持同一套口径 */
export type GraphicType = QuadItem['type'];

export interface GraphicOptions {
  /** 场景内唯一 id（四叉树、拾取、实例数据都按它索引） */
  id: number;
  /** 位置：世界坐标中心点，默认 (0, 0) */
  x?: number;
  y?: number;
  /** 大小：世界单位宽高，默认 0 */
  width?: number;
  height?: number;
  /** 旋转：弧度，逆时针为正，默认 0 */
  rotation?: number;
  /** 是否参与绘制与剔除，默认 true */
  visible?: boolean;
  /** 初始选中态，默认 false */
  selected?: boolean;
}

export abstract class Graphic implements QuadItem {
  readonly id: number;

  /** 位置：世界坐标中心点 */
  x: number;
  y: number;
  /** 大小：世界单位宽高 */
  width: number;
  height: number;
  /** 旋转：弧度（逆时针为正，与 WGSL 侧同一套约定） */
  rotation: number;

  /** 基本属性：是否可见 */
  visible: boolean;
  /** 基本属性：是否选中 */
  selected: boolean;
  /** 变更标记：几何或状态改过就为 true，渲染侧消费后可 clearDirty() */
  dirty: boolean;

  /** 世界包围盒缓存（四叉树插入/剔除会频繁读它，避免每次重算） */
  private aabbCache: AABB | null = null;

  constructor(options: GraphicOptions) {
    this.id = options.id;
    this.x = options.x ?? 0;
    this.y = options.y ?? 0;
    this.width = options.width ?? 0;
    this.height = options.height ?? 0;
    this.rotation = options.rotation ?? 0;
    this.visible = options.visible ?? true;
    this.selected = options.selected ?? false;
    this.dirty = true;
  }

  /** 图形类型（实例化渲染契约字段） */
  abstract get type(): GraphicType;

  /** 子类按自身几何算世界包围盒（矩形按旋转矩形，折线按折线包围盒） */
  protected abstract computeWorldAABB(): AABB;

  /** 世界包围盒：缓存 + 变更失效，四叉树与拾取直接用它 */
  get worldAABB(): AABB {
    this.aabbCache ??= this.computeWorldAABB();
    return this.aabbCache;
  }

  // ---- 实例化渲染契约别名：位置/大小/旋转与 tx/ty/sx/sy/beta 是同一份数据 ----

  get tx(): number {
    return this.x;
  }

  get ty(): number {
    return this.y;
  }

  get sx(): number {
    return this.width;
  }

  get sy(): number {
    return this.height;
  }

  get beta(): number {
    return this.rotation;
  }

  /** 实例契约里选中态是 float（着色器按 > 0.5 判定） */
  get selectedFlag(): number {
    return this.selected ? 1 : 0;
  }

  // ---- 位置 / 大小 / 基本属性 ----

  /** 移动到世界坐标中心点 */
  setPosition(x: number, y: number): this {
    if (this.x === x && this.y === y) return this;
    this.x = x;
    this.y = y;
    this.invalidate();
    return this;
  }

  /** 相对移动（拖动时用） */
  moveBy(dx: number, dy: number): this {
    if (dx === 0 && dy === 0) return this;
    this.x += dx;
    this.y += dy;
    this.invalidate();
    return this;
  }

  /** 设置大小（世界单位宽高） */
  setSize(width: number, height: number): this {
    if (this.width === width && this.height === height) return this;
    this.width = width;
    this.height = height;
    this.invalidate();
    return this;
  }

  /** 设置旋转（弧度） */
  setRotation(rotation: number): this {
    if (this.rotation === rotation) return this;
    this.rotation = rotation;
    this.invalidate();
    return this;
  }

  setVisible(visible: boolean): this {
    if (this.visible === visible) return this;
    this.visible = visible;
    this.dirty = true;
    return this;
  }

  setSelected(selected: boolean): this {
    if (this.selected === selected) return this;
    this.selected = selected;
    this.dirty = true;
    return this;
  }

  /** 渲染侧消费完变更后调用 */
  clearDirty(): void {
    this.dirty = false;
  }

  /** 外部就地改了几何（例如批量写折线顶点）后调用：让包围盒缓存失效并标记 dirty */
  markGeometryDirty(): void {
    this.invalidate();
  }

  /** 几何或状态变化：标记 dirty 并让包围盒缓存失效 */
  protected invalidate(): void {
    this.aabbCache = null;
    this.dirty = true;
  }
}
