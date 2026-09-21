/**
 * 按需字形图集（dynamic glyph atlas）。
 *
 * 不在启动时烘焙固定字符集，而是「第一次用到某个字」才光栅化并写进图集：
 *   - 一张图集 = 一套字体与字号；换字号就换图集实例
 *   - shelf 打包分配格子，命中缓存直接返回 uv，新增格子用 writeTexture 局部写入
 *   - 中文与 ASCII 走同一条路径：汉字再多也只烘焙真正显示过的字
 *
 * 注意：canvas 纹理是预乘 alpha，绘制端把采样结果直接乘到颜色上即可（白色字形 = 取 alpha）。
 */
import { createTextureFromBitmap, type Texture2d } from '@/core/gpu/texture';
import { createTextureSampler } from '@/core/gpu/texture';

export interface GlyphEntry {
  /** 图集内的像素矩形；uv 在排版时按当前图集尺寸换算，扩容后依然正确 */
  x: number;
  y: number;
  /** 字形步进（逻辑像素） */
  advance: number;
  /** 格子尺寸（逻辑像素），绘制端据此换算世界尺寸 */
  cellWidth: number;
  cellHeight: number;
  /**
   * 格子顶边到基线的距离（逻辑像素）。
   * 同一行的所有字共用一条基线，排版时用 `基线 y - baselineOffset` 反推格子顶边，
   * 这样数字 / 括号 / 带降部的字母才会坐在同一条基线上，而不是各按自己的墨迹居中。
   */
  baselineOffset: number;
  /**
   * 图集里的实际像素尺寸（超采样后 = 逻辑尺寸 × rasterScale）。
   * uv 按它算；不填视为与逻辑尺寸相同（测试用的假图集）。
   */
  rasterWidth?: number;
  rasterHeight?: number;
}

export interface GlyphAtlasOptions {
  fontFamily?: string;
  fontSizePx?: number;
  /** 图集纹理尺寸，默认 512×512（约可容纳上千个常用汉字） */
  textureWidthPx?: number;
  textureHeightPx?: number;
  /** 格子内边距，避免线性采样吸到相邻字形 */
  paddingPx?: number;
  /**
   * 烘焙超采样倍率，默认 3：字形按 `fontSizePx × rasterScale` 光栅化进图集，
   * 对外仍按逻辑字号排版与绘制。文字按世界单位缩放时，放大 3 倍以内不会有锯齿。
   */
  rasterScale?: number;
  /**
   * 行高倍率，默认 1.2（与 draw.io 的 `line-height: 1.2` 同口径）：
   * 行距（行盒高）= `fontSizePx × lineHeightRatio`。
   */
  lineHeightRatio?: number;
}

/**
 * 字形光栅化接口：默认实现基于 canvas；测试可注入假实现，
 * 从而在 Node 环境下验证 uv 分配、图集满处理等纯逻辑。
 */
export interface GlyphRasterizer {
  readonly width: number;
  readonly height: number;
  /** 量取字形度量（像素） */
  measure(char: string): { advance: number; ascent: number; descent: number };
  /** 以基线为原点绘制字形 */
  draw(char: string, x: number, baselineY: number): void;
  /** 读取一块像素（RGBA，未预乘） */
  read(x: number, y: number, width: number, height: number): Uint8ClampedArray;
}

/**
 * 默认字体：**微软雅黑优先**（一套字同时包含中英文，中英混排最稳），
 * 后面按平台回退：macOS 苹方 PingFang SC / 黑体 Heiti SC，Linux 落到 sans-serif。
 */
export const DEFAULT_FONT_FAMILY =
  "'Microsoft YaHei', 'PingFang SC', 'Hiragino Sans GB', 'Heiti SC', 'SimHei', Arial, sans-serif";

/**
 * 默认行高倍率：draw.io 的默认样式与富文本都会写 `line-height: 1.2`，
 * 所以「行距 = 字号 × 1.2」是复刻图纸行距的口径。
 */
export const DEFAULT_LINE_HEIGHT_RATIO = 1.2;

export class GlyphAtlas {
  /** 纹理会在扩容时重建，因此非只读 */
  texture: Texture2d;
  readonly sampler: GPUSampler;
  readonly fontSizePx: number;
  /** 烘焙超采样倍率（字形位图 = 逻辑字号 × 该倍率） */
  readonly rasterScale: number;
  /** 行高倍率（行距 = 字号 × 它） */
  readonly lineHeightRatio: number;
  /** 行距 / 行盒高（逻辑像素），多行排版按它排 */
  readonly lineHeight: number;
  /**
   * 字体级 ascent / descent（逻辑像素，descent 为正）：行盒里基线的位置由它算——
   * 基线 = 行盒顶 + 半行距 + ascent，与浏览器给 `line-height` 排版的 strut 同口径。
   */
  readonly ascentPx: number;
  readonly descentPx: number;

  private readonly device: GPUDevice;
  private readonly font: string;
  private ctx: CanvasRenderingContext2D;
  private canvas: HTMLCanvasElement | OffscreenCanvas;
  private readonly paddingPx: number;
  private readonly glyphs = new Map<string, GlyphEntry>();
  // shelf 打包游标
  private cursorX = 0;
  private cursorY = 0;
  private shelfHeight = 0;

  constructor(device: GPUDevice, options: GlyphAtlasOptions = {}) {
    const {
      fontFamily = DEFAULT_FONT_FAMILY,
      fontSizePx = 16,
      rasterScale = 3,
      lineHeightRatio = DEFAULT_LINE_HEIGHT_RATIO,
      textureWidthPx = 512,
      textureHeightPx = 512,
      paddingPx = 2,
    } = options;

    this.device = device;
    this.fontSizePx = fontSizePx;
    this.rasterScale = Math.max(rasterScale, 1);
    this.lineHeightRatio = lineHeightRatio;
    this.lineHeight = fontSizePx * lineHeightRatio;
    this.paddingPx = paddingPx;
    // 光栅化按「逻辑字号 × 超采样倍率」，排版与绘制仍用逻辑字号
    this.font = `${fontSizePx * this.rasterScale}px ${fontFamily}`;
    this.canvas =
      typeof OffscreenCanvas === 'undefined'
        ? document.createElement('canvas')
        : new OffscreenCanvas(textureWidthPx, textureHeightPx);
    this.canvas.width = textureWidthPx;
    this.canvas.height = textureHeightPx;

    // willReadFrequently：每个新字形都要 getImageData，加这个标记避免反复从 GPU 回读
    const ctx = this.canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('无法创建 2D 上下文，字形图集光栅化失败');
    this.ctx = ctx as unknown as CanvasRenderingContext2D;
    this.ctx.font = this.font;
    this.ctx.textAlign = 'left';
    this.ctx.textBaseline = 'alphabetic';
    this.ctx.fillStyle = '#ffffff';

    // 字体级度量取整行的「样式盒」而不是某个字的墨迹：`fontBoundingBox*` 缺失时退回经验比例
    const probe = this.ctx.measureText('Hg');
    this.ascentPx = fontMetricAtScale(
      probe,
      'fontBoundingBoxAscent',
      this.rasterScale,
      fontSizePx * 0.8,
    );
    this.descentPx = fontMetricAtScale(
      probe,
      'fontBoundingBoxDescent',
      this.rasterScale,
      fontSizePx * 0.2,
    );

    this.texture = createTextureFromBitmap(device, this.canvas, 'glyph-atlas');
    this.sampler = createTextureSampler(device, 'glyph-atlas-sampler');
  }

  /** 取字形；首次访问才烘焙。图集满时返回 undefined（调用方可换新图集实例） */
  getGlyph(char: string): GlyphEntry | undefined {
    const cached = this.glyphs.get(char);
    if (cached) return cached;

    const scale = this.rasterScale;
    const metrics = this.ctx.measureText(char);
    // 图集里按超采样尺寸光栅化，逻辑尺寸对外用（除以倍率）
    const rasterAdvance = Math.max(metrics.width, 1);
    const rasterAscent = Math.ceil(
      metrics.actualBoundingBoxAscent || this.fontSizePx * scale * 0.8,
    );
    const rasterDescent = Math.ceil(
      metrics.actualBoundingBoxDescent || this.fontSizePx * scale * 0.2,
    );
    const rasterWidth = Math.ceil(rasterAdvance) + this.paddingPx * scale * 2;
    const rasterHeight = rasterAscent + rasterDescent + this.paddingPx * scale * 2;
    const advance = rasterAdvance / scale;
    const cellWidth = rasterWidth / scale;
    const cellHeight = rasterHeight / scale;

    // 图集满：扩容一页（尺寸翻倍、保留已烘焙字形），再重新分配
    let slot = this.allocate(rasterWidth, rasterHeight);
    if (!slot) {
      this.grow();
      slot = this.allocate(rasterWidth, rasterHeight);
    }
    if (!slot) return undefined;

    // 画进格子：基线 = 顶部 padding + ascent
    const paddingRaster = this.paddingPx * scale;
    this.ctx.fillText(char, slot.x + paddingRaster, slot.y + paddingRaster + rasterAscent);
    // 只把这一小块写进图集纹理，不重建整张纹理
    const image = this.ctx.getImageData(slot.x, slot.y, rasterWidth, rasterHeight);
    this.device.queue.writeTexture(
      { texture: this.texture.texture, origin: [slot.x, slot.y] },
      image.data,
      { bytesPerRow: rasterWidth * 4 },
      [rasterWidth, rasterHeight],
    );

    const entry: GlyphEntry = {
      x: slot.x,
      y: slot.y,
      advance,
      cellWidth,
      cellHeight,
      // 格子顶边到基线：顶部 padding + 该字的 ascent（换算回逻辑像素）
      baselineOffset: (paddingRaster + rasterAscent) / scale,
      rasterWidth,
      rasterHeight,
    };
    this.glyphs.set(char, entry);
    return entry;
  }

  /** 已烘焙字数（调试/监控用） */
  get size(): number {
    return this.glyphs.size;
  }

  /** shelf 打包：一行放满就换下一行 */
  private allocate(width: number, height: number): { x: number; y: number } | null {
    if (this.cursorX + width > this.canvas.width) {
      this.cursorX = 0;
      this.cursorY += this.shelfHeight;
      this.shelfHeight = 0;
    }
    if (this.cursorY + height > this.canvas.height) return null;

    const slot = { x: this.cursorX, y: this.cursorY };
    this.cursorX += width;
    this.shelfHeight = Math.max(this.shelfHeight, height);
    return slot;
  }

  /**
   * 扩容：画布尺寸翻倍，把已有字形原样拷到左上角，再重建纹理。
   * 条目不存 uv（只存像素矩形），所以旧字形的 uv 会随新尺寸自动正确。
   */
  private grow() {
    const nextWidth = this.canvas.width * 2;
    const nextHeight = this.canvas.height * 2;
    const nextCanvas =
      typeof OffscreenCanvas === 'undefined'
        ? document.createElement('canvas')
        : new OffscreenCanvas(nextWidth, nextHeight);
    nextCanvas.width = nextWidth;
    nextCanvas.height = nextHeight;

    const nextCtx = nextCanvas.getContext('2d', { willReadFrequently: true });
    if (!nextCtx) throw new Error('字形图集扩容失败：无法创建 2D 上下文');
    nextCtx.drawImage(this.canvas, 0, 0);

    this.texture.texture.destroy();
    this.canvas = nextCanvas;
    this.ctx = nextCtx as unknown as CanvasRenderingContext2D;
    this.ctx.font = this.font;
    this.ctx.textAlign = 'left';
    this.ctx.textBaseline = 'alphabetic';
    this.ctx.fillStyle = '#ffffff';
    this.texture = createTextureFromBitmap(this.device, nextCanvas, 'glyph-atlas');
  }
}

/**
 * 按字素簇切分文本：中文、组合字、emoji 都不能按 UTF-16 单字符切。
 * 优先 Intl.Segmenter，环境不支持时退化为按码点切分。
 */
export function splitGraphemes(text: string): string[] {
  if (typeof Intl !== 'undefined' && 'Segmenter' in Intl) {
    const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
    return [...segmenter.segment(text)].map((item) => item.segment);
  }
  return Array.from(text);
}

/**
 * 取字体级度量并换算回逻辑像素。
 * 度量是在「字号 × 超采样倍率」下量的，所以这里除以倍率；
 * 浏览器没实现该属性（老 Safari）时退回经验比例，保证行盒里的基线始终有值。
 */
function fontMetricAtScale(
  metrics: TextMetrics,
  key: 'fontBoundingBoxAscent' | 'fontBoundingBoxDescent',
  rasterScale: number,
  fallbackPx: number,
): number {
  const raw = (metrics as unknown as Record<string, unknown>)[key];
  if (typeof raw !== 'number' || !Number.isFinite(raw) || raw <= 0) return fallbackPx;
  return raw / rasterScale;
}
