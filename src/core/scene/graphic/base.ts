/**
 * 图形基础层：一个场景项的最小属性集 —— 身份 + 世界变换 + 可见/变更标记 + 世界 AABB。
 *
 * 这一层不涉及外观、形状，也没有「选中」与「流动」这两类能力（它们分属上层：
 * 图形可选中、管线有流动），也不认识任何业务概念：四叉树索引、视口剔除、坐标变换口径
 * 与拾取只需要这些。
 *
 * 分层口径（core/scene）：
 *  - `GraphicBase`：基础属性（本文件）
 *  - `Graphic`：绘制属性（外观 + 形状 + 打包）
 *  - `DataGraphic`：使用方自定义数据 `data`
 *  - `SelectableGraphic` / `FlowGraphic`：两种互斥能力——图形可选中、管线有流动
 */
import { computeRotatedAABB } from '@/core/geometry/aabb';
import type { AABB, QuadItem } from '@/core/types';

export interface GraphicBaseOptions {
  /** 场景内唯一 id（四叉树、拾取、实例数据都按它索引） */
  id: number;
  /** 位置：世界坐标中心点，默认 (0, 0) */
  x?: number;
  y?: number;
  /** 大小：包围盒宽高，默认 0 */
  width?: number;
  height?: number;
  /** 旋转：弧度，逆时针为正，默认 0 */
  rotation?: number;
  /** 是否参与绘制与剔除，默认 true */
  visible?: boolean;
}

export class GraphicBase implements QuadItem {
  readonly id: number;

  /** 位置：世界坐标中心点 */
  x: number;
  y: number;
  /** 大小：包围盒宽高 */
  width: number;
  height: number;
  /** 旋转：弧度（逆时针为正，与 WGSL 侧同一套约定） */
  rotation: number;

  /** 基本属性：是否可见 */
  visible: boolean;
  /** 变更标记：几何或状态改过就为 true，渲染侧消费后 clearDirty() */
  dirty: boolean;

  /** 世界包围盒缓存（四叉树插入/剔除会频繁读它，避免每次重算） */
  private aabbCache: AABB | null = null;

  constructor(options: GraphicBaseOptions) {
    this.id = options.id;
    this.x = options.x ?? 0;
    this.y = options.y ?? 0;
    this.width = options.width ?? 0;
    this.height = options.height ?? 0;
    this.rotation = options.rotation ?? 0;
    this.visible = options.visible ?? true;
    this.dirty = true;
  }

  // 位置 / 大小 / 基本属性

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

  /** 设置大小（包围盒宽高） */
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

  /** 渲染侧消费完变更后调用 */
  clearDirty(): void {
    this.dirty = false;
  }

  /** 外部就地改了几何（例如批量写折线顶点）后调用：让包围盒缓存失效并标记 dirty */
  markGeometryDirty(): void {
    this.invalidate();
  }

  // 空间与实例契约

  /** 世界包围盒：缓存 + 变更失效，四叉树与拾取直接用它 */
  get worldAABB(): AABB {
    this.aabbCache ??= this.computeWorldAABB();
    return this.aabbCache;
  }

  /** 包围盒算法：基础层按「中心 + 宽高 + 旋转」算；折线等特殊几何由上层覆盖 */
  protected computeWorldAABB(): AABB {
    return computeRotatedAABB(this.x, this.y, this.width, this.height, this.rotation);
  }

  // 实例化渲染契约别名：位置/大小/旋转与 tx/ty/sx/sy/beta 是同一份数据
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

  /**
   * 实例契约里的选中通道：基础层没有「选中」概念，恒为 0；
   * 可选中的图形在 `SelectableGraphic` 里覆盖成真实值。
   */
  protected get selectedFlag(): number {
    return 0;
  }

  /** 几何或状态变化：标记 dirty 并让包围盒缓存失效 */
  protected invalidate(): void {
    this.aabbCache = null;
    this.dirty = true;
  }
}
