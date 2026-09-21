/**
 * 图形基类：全库唯一一层抽象（用法参考 PixiJS 的 `Graphics`）。
 *
 * 一个图形 = 位置 / 大小 / 基本属性 + 外观（填充、描边）+ 状态（开关、hover）+ 形状。
 * **形状不靠继承区分，而是绘制命令**——正方形、长方形、圆形、折线都画在同一个对象上，
 * 差别只是外观与几何。内核不认「这是阀门还是管线」：渲染只按形状编码裁实例，
 * 图元属于哪类业务概念、该走哪条管线，都由上层自己决定。
 *
 * ```ts
 * const g = new Graphic({ id: 1, x: 100, y: 100 });
 * g.rect(80, 60).fill(RED).stroke(BLUE, 2);   // 长方形；正方形就 rect(80, 80)
 * g.circle(40).fill(GRAY);                    // 圆形；宽高不等即椭圆
 * g.triangle(40, 32).fill(GREEN);             // 三角形（内切于包围盒，底边在下、尖端在上）
 * g.polyline(points, 4).fill(GREEN);          // 折线（管线），粗细按屏幕像素
 * ```
 *
 * 约定：
 *  - 位置 = 中心点，大小 = 包围盒宽高，旋转 = 弧度（与实例化渲染契约同一套口径）
 *  - 实现 `QuadTreeItem`：图形可以直接进 `QuadTreeStore`，剔除/拾取不需要适配层
 *  - 几何或状态一变就 `dirty = true` 并让包围盒缓存失效
 */
import { computeRotatedAABB } from '@/core/geometry/aabb';
import { calcPolylineBounds, type Point } from '@/core/geometry/polyline';
import type { AABB, PrimitiveInstance, QuadItem } from '@/core/types';

/** 图集 uv 矩形 (u0, v0, u1, v1)：贴图/字形用，默认整张纹理 */
export type AtlasUvRect = readonly [number, number, number, number];

/** 逐实例颜色 (r, g, b, a)，分量取值 0~1 */
export type Rgba = readonly [number, number, number, number];

/** 整张纹理（不贴图/白纹理时用）：uv 全覆盖 */
const FULL_TEXTURE_UV: AtlasUvRect = [0, 0, 1, 1];

/** 形状：三角形、矩形、圆、折线 */
export type GraphicShape = 'triangle' | 'rect' | 'circle' | 'polyline';

/** 形状编码：写进实例的 shape 通道，着色器按它裁形状 */
export const GRAPHIC_SHAPE_RECT = 0;
export const GRAPHIC_SHAPE_CIRCLE = 1;
export const GRAPHIC_SHAPE_TRIANGLE = 2;

export interface GraphicOptions {
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
  /** 初始选中态，默认 false */
  selected?: boolean;
  /** 填充色（管线里就是管身底色）；null 表示不填——该图元不绘制，也不参与拾取 */
  fillColor?: Rgba | null;
  /** 图集 uv 矩形，默认整张纹理 */
  atlasUvRect?: AtlasUvRect;
  /** width/height 的单位：world = 世界单位（默认），screen = 屏幕像素（打包时按相机缩放折算） */
  sizeUnit?: GraphicSizeUnit;
  /** 描边色与宽度（strokeWidth <= 0 视为不描边） */
  strokeColor?: Rgba | null;
  strokeWidth?: number;
  /** 开关状态，默认打开 */
  open?: boolean;
  /** 打开时的动画速度倍率（0 表示不流动） */
  animationSpeed?: number;
}

/** 尺寸口径：世界单位（随缩放变大变小）或屏幕像素（视觉尺寸恒定） */
export type GraphicSizeUnit = 'world' | 'screen';

export class Graphic implements QuadItem {
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
  /** 基本属性：是否选中 */
  selected: boolean;
  /** 变更标记：几何或状态改过就为 true，渲染侧消费后 clearDirty() */
  dirty: boolean;

  /** 外观：填充色 */
  fillColor: Rgba | null;
  /** 外观：图集 uv 矩形（贴图/字形），默认整张纹理 */
  atlasUvRect: AtlasUvRect;
  /** 尺寸口径：world = 世界单位，screen = 屏幕像素（打包时按相机缩放折算） */
  sizeUnit: GraphicSizeUnit;
  /** 外观：描边色与宽度 */
  strokeColor: Rgba | null;
  strokeWidth: number;

  /** 状态：开关（阀门开闭、管线通断…） */
  open: boolean;
  /** 状态：鼠标是否悬停 */
  hovered: boolean;

  /** 动画：打开时的速度倍率与沿自身的相位里程 */
  animationSpeed: number;
  flowOffset: number;

  /** 折线顶点（shape = 'polyline' 时有效） */
  points: Point[];
  /** 折线粗细：屏幕像素（放大缩小后视觉粗细恒定） */
  lineWidthPx: number;

  private shapeKind: GraphicShape = 'rect';
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

    this.fillColor = options.fillColor ?? null;
    this.atlasUvRect = options.atlasUvRect ?? FULL_TEXTURE_UV;
    this.sizeUnit = options.sizeUnit ?? 'world';
    this.strokeColor = options.strokeColor ?? null;
    this.strokeWidth = options.strokeWidth ?? 0;

    this.open = options.open ?? true;
    this.hovered = false;

    this.animationSpeed = options.animationSpeed ?? 1;
    this.flowOffset = 0;

    this.points = [];
    this.lineWidthPx = 2;
  }

  // ---- 形状：绘制命令（链式，形状差异只是外观差异） ----

  get shape(): GraphicShape {
    return this.shapeKind;
  }

  /** 矩形/正方形：宽高相等即正方形 */
  rect(width: number, height = width): this {
    this.shapeKind = 'rect';
    this.setSize(width, height);
    return this;
  }

  /** 正方形 */
  square(size: number): this {
    return this.rect(size, size);
  }

  /** 圆：宽高相等时是正圆，宽高不等就是椭圆（内切于包围盒） */
  circle(diameter: number): this {
    return this.ellipse(diameter, diameter);
  }

  /** 椭圆：宽高就是包围盒 */
  ellipse(width: number, height: number): this {
    this.shapeKind = 'circle';
    this.setSize(width, height);
    return this;
  }

  /**
   * 三角形：内切于包围盒，底边在下、尖端在上（等腰）。
   * 换朝向用 `setRotation`（例如 -90° 得到尖端朝右），换胖瘦用 `setSize`。
   */
  triangle(width: number, height = width): this {
    this.shapeKind = 'triangle';
    this.setSize(width, height);
    return this;
  }

  /** 折线（管线/连线）：粗细按屏幕像素 */
  polyline(points: readonly Point[], lineWidthPx = this.lineWidthPx): this {
    this.shapeKind = 'polyline';
    this.points = [...points];
    this.lineWidthPx = lineWidthPx;
    this.flowOffset = 0;
    this.invalidate();
    return this;
  }

  // ---- 外观：填充与描边 ----

  /** 填充色 */
  fill(color: Rgba | null): this {
    this.fillColor = color;
    this.dirty = true;
    return this;
  }

  /** 描边色与宽度 */
  stroke(color: Rgba | null, width = this.strokeWidth): this {
    this.strokeColor = color;
    this.strokeWidth = width;
    this.dirty = true;
    return this;
  }

  /** 图集 uv 矩形（贴图/字形）；不贴图时保持默认的整张纹理 */
  atlasUv(rect: AtlasUvRect): this {
    this.atlasUvRect = rect;
    this.dirty = true;
    return this;
  }

  noFill(): this {
    return this.fill(null);
  }

  noStroke(): this {
    return this.stroke(null, 0);
  }

  /** 是否有描边 */
  get hasStroke(): boolean {
    return this.strokeWidth > 0 && this.strokeColor !== null;
  }

  // ---- 状态与动画 ----

  /** 是否正在动画：打开且速度非 0 */
  get animated(): boolean {
    return this.open && this.animationSpeed !== 0;
  }

  /** 交给渲染的动画速度：关闭时为 0（静止的外观） */
  get currentAnimationSpeed(): number {
    return this.animated ? this.animationSpeed : 0;
  }

  /** 设置开关状态（阀门开闭、管线通断） */
  setOpen(open: boolean): this {
    if (this.open === open) return this;
    this.open = open;
    this.dirty = true;
    return this;
  }

  toggleOpen(): this {
    return this.setOpen(!this.open);
  }

  setHovered(hovered: boolean): this {
    if (this.hovered === hovered) return this;
    this.hovered = hovered;
    this.dirty = true;
    return this;
  }

  setAnimationSpeed(speed: number): this {
    if (this.animationSpeed === speed) return this;
    this.animationSpeed = speed;
    this.dirty = true;
    return this;
  }

  /** 推进动画相位（世界单位），按沿图形的里程调用 */
  advanceFlow(distance: number): this {
    this.flowOffset += distance;
    return this;
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

  /**
   * 按屏幕像素定尺寸：视觉尺寸不随相机缩放变化（贴图符号、文字用）。
   * 世界包围盒仍按当前 width/height 算，所以这里的像素尺寸只在打包成实例时折算。
   */
  screenSize(widthPx: number, heightPx: number): this {
    this.sizeUnit = 'screen';
    return this.setSize(widthPx, heightPx);
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

  /** 更新折线顶点（几何变更） */
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

  /** 渲染侧消费完变更后调用 */
  clearDirty(): void {
    this.dirty = false;
  }

  /** 外部就地改了几何（例如批量写折线顶点）后调用：让包围盒缓存失效并标记 dirty */
  markGeometryDirty(): void {
    this.invalidate();
  }

  // 渲染契约

  /**
   * 打包成一个实例：内核唯一的「图形 → 实例」出口。
   * 颜色只用 `fillColor`（null = 没颜色 = 不绘制），尺寸按 `sizeUnit` 决定是否折算相机缩放。
   */
  toInstance(pixelsPerWorldUnit = 1): PrimitiveInstance {
    const unitScale = this.sizeUnit === 'screen' ? 1 / Math.max(pixelsPerWorldUnit, 1e-6) : 1;
    const [u0, v0, u1, v1] = this.atlasUvRect;
    const fill = this.fillColor;
    return {
      sx: this.width * unitScale,
      sy: this.height * unitScale,
      beta: this.rotation,
      tx: this.x,
      ty: this.y,
      selected: this.selectedFlag,
      u0,
      v0,
      u1,
      v1,
      colorR: fill?.[0] ?? 0,
      colorG: fill?.[1] ?? 0,
      colorB: fill?.[2] ?? 0,
      colorA: fill?.[3] ?? 0,
      shape: this.shapeCode,
    };
  }

  /** 形状编码：交给渲染侧裁形状 */
  get shapeCode(): number {
    if (this.shape === 'triangle') return GRAPHIC_SHAPE_TRIANGLE;
    if (this.shape === 'circle') return GRAPHIC_SHAPE_CIRCLE;
    return GRAPHIC_SHAPE_RECT;
  }

  /** 世界包围盒：缓存 + 变更失效，四叉树与拾取直接用它 */
  get worldAABB(): AABB {
    this.aabbCache ??=
      this.shape === 'polyline'
        ? calcPolylineBounds(this.points)
        : computeRotatedAABB(this.x, this.y, this.width, this.height, this.rotation);
    return this.aabbCache;
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

  /** 实例契约里选中态是 float（着色器按 > 0.5 判定） */
  get selectedFlag(): number {
    return this.selected ? 1 : 0;
  }

  /** 几何或状态变化：标记 dirty 并让包围盒缓存失效 */
  protected invalidate(): void {
    this.aabbCache = null;
    this.dirty = true;
  }
}

/** 批量打包：上层只负责建 `Graphic`，装箱统一走这里 */
export function toInstances(
  graphics: readonly Graphic[],
  pixelsPerWorldUnit = 1,
): PrimitiveInstance[] {
  return graphics.map((graphic) => graphic.toInstance(pixelsPerWorldUnit));
}
