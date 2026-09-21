/**
 * 图形绘制层：在基础层（`GraphicBase`：身份 + 变换 + 可见）之上，加「外观 + 形状」。
 *
 * 一个图形 = 基础属性 + 外观（填充、描边、uv、尺寸口径）+ 形状。
 * **形状不靠继承区分，而是绘制命令**——正方形、长方形、圆形、折线都画在同一个对象上，
 * 差别只是外观与几何。内核不认「这是阀门还是管线」：渲染只按形状编码裁实例，
 * 图元属于哪类业务概念、该走哪条管线，都由上层自己决定。
 *
 * 这一层不带「选中」（图形能力，见 `SelectableGraphic`）也不带「流动」（管线能力，
 * 见 `FlowGraphic`）：两种能力分属不同层，互不干扰。
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
 *  - 实现 `QuadTreeItem`（继承自 `GraphicBase`）：图形可以直接进 `QuadTreeStore`
 *  - 几何或状态一变就 `dirty = true` 并让包围盒缓存失效
 *  - 这一层只管「怎么画」；要携带用户数据的图元用 `@/core/scene/graphic/data` 的 `DataGraphic`
 */
import { calcPolylineBounds, type Point } from '@/core/geometry/polyline';
import { GraphicBase, type GraphicBaseOptions } from '@/core/scene/graphic/base';
import type { AABB, PrimitiveInstance } from '@/core/types';

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
/** 描边环 = 基础形状 + 3（3 = 方框环 / 4 = 圆环 / 5 = 三角环），实例用 `borderWidthPx` 给粗细 */
export const GRAPHIC_SHAPE_RING_OFFSET = 3;

/** 尺寸口径：世界单位（随缩放变大变小）或屏幕像素（视觉尺寸恒定） */
export type GraphicSizeUnit = 'world' | 'screen';

export interface GraphicOptions extends GraphicBaseOptions {
  /** 填充色（管线里就是管身底色）；null 表示不填——该图元不绘制，也不参与拾取 */
  fillColor?: Rgba | null;
  /** 图集 uv 矩形，默认整张纹理 */
  atlasUvRect?: AtlasUvRect;
  /** width/height 的单位：world = 世界单位（默认），screen = 屏幕像素（打包时按相机缩放折算） */
  sizeUnit?: GraphicSizeUnit;
  /** 描边色与宽度（strokeWidth <= 0 视为不描边） */
  strokeColor?: Rgba | null;
  strokeWidth?: number;
}

export class Graphic extends GraphicBase {
  /** 外观：填充色 */
  fillColor: Rgba | null;
  /** 外观：图集 uv 矩形（贴图/字形），默认整张纹理 */
  atlasUvRect: AtlasUvRect;
  /** 尺寸口径：world = 世界单位，screen = 屏幕像素（打包时按相机缩放折算） */
  sizeUnit: GraphicSizeUnit;
  /** 外观：描边色与宽度 */
  strokeColor: Rgba | null;
  strokeWidth: number;

  /** 折线顶点（shape = 'polyline' 时有效） */
  points: Point[];
  /** 折线粗细：屏幕像素（放大缩小后视觉粗细恒定） */
  lineWidthPx: number;

  private shapeKind: GraphicShape = 'rect';

  constructor(options: GraphicOptions) {
    super(options);

    this.fillColor = options.fillColor ?? null;
    this.atlasUvRect = options.atlasUvRect ?? FULL_TEXTURE_UV;
    this.sizeUnit = options.sizeUnit ?? 'world';
    this.strokeColor = options.strokeColor ?? null;
    this.strokeWidth = options.strokeWidth ?? 0;

    this.points = [];
    this.lineWidthPx = 2;
  }

  /* ---- 形状：绘制命令（链式，形状差异只是外观差异） ---- */

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
    this.invalidate();
    return this;
  }

  /* ---- 外观：填充与描边 ---- */

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

  /**
   * 按屏幕像素定尺寸：视觉尺寸不随相机缩放变化（贴图符号、文字用）。
   * 世界包围盒仍按当前 width/height 算，所以这里的像素尺寸只在打包成实例时折算。
   */
  screenSize(widthPx: number, heightPx: number): this {
    this.sizeUnit = 'screen';
    return this.setSize(widthPx, heightPx);
  }

  /** 更新折线顶点（几何变更） */
  setPoints(points: readonly Point[]): this {
    this.points = [...points];
    this.invalidate();
    return this;
  }

  setLineWidthPx(lineWidthPx: number): this {
    if (this.lineWidthPx === lineWidthPx) return this;
    this.lineWidthPx = lineWidthPx;
    this.dirty = true;
    return this;
  }

  /* ---- 渲染契约 ---- */

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
      borderWidthPx: 0,
    };
  }

  /**
   * 打包成「描边环」实例：把图形当前形状的轮廓画成 borderWidthPx 像素宽的环。
   * 没有描边时返回 null（调用方据此跳过）。
   */
  toBorderInstance(pixelsPerWorldUnit = 1): PrimitiveInstance | null {
    if (!this.hasStroke) return null;
    const instance = this.toInstance(pixelsPerWorldUnit);
    const stroke = this.strokeColor;
    return {
      ...instance,
      /* 环用描边色（填充实例的颜色通道可能就是填充色），形状换成对应的环 */
      colorR: stroke?.[0] ?? 0,
      colorG: stroke?.[1] ?? 0,
      colorB: stroke?.[2] ?? 0,
      colorA: stroke?.[3] ?? 0,
      shape: this.shapeCode + GRAPHIC_SHAPE_RING_OFFSET,
      borderWidthPx: this.strokeWidth,
    };
  }

  /** 形状编码：交给渲染侧裁形状 */
  get shapeCode(): number {
    if (this.shape === 'triangle') return GRAPHIC_SHAPE_TRIANGLE;
    if (this.shape === 'circle') return GRAPHIC_SHAPE_CIRCLE;
    return GRAPHIC_SHAPE_RECT;
  }

  /** 折线按顶点算包围盒，其余形状沿用基础层的「中心 + 宽高 + 旋转」 */
  protected override computeWorldAABB(): AABB {
    return this.shape === 'polyline' ? calcPolylineBounds(this.points) : super.computeWorldAABB();
  }
}

/** 批量打包：上层只负责建 `Graphic`，装箱统一走这里 */
export function toInstances(
  graphics: readonly Graphic[],
  pixelsPerWorldUnit = 1,
): PrimitiveInstance[] {
  const instances: PrimitiveInstance[] = [];
  for (const graphic of graphics) {
    instances.push(graphic.toInstance(pixelsPerWorldUnit));
    const border = graphic.toBorderInstance(pixelsPerWorldUnit);
    if (border) instances.push(border);
  }
  return instances;
}
