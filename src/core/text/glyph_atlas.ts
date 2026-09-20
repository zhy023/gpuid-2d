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
  /** 字形步进（像素） */
  advance: number;
  /** 格子尺寸（像素），绘制端据此换算世界尺寸 */
  cellWidth: number;
  cellHeight: number;
}

export interface GlyphAtlasOptions {
  fontFamily?: string;
  fontSizePx?: number;
  /** 图集纹理尺寸，默认 512×512（约可容纳上千个常用汉字） */
  textureWidthPx?: number;
  textureHeightPx?: number;
  /** 格子内边距，避免线性采样吸到相邻字形 */
  paddingPx?: number;
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
 * 默认字体：黑体系。
 * 用回退链覆盖各平台（macOS 黑体 Heiti SC / 苹方 PingFang SC，Windows SimHei/雅黑，Linux 落到 sans-serif）。
 */
export const DEFAULT_FONT_FAMILY =
  "'SimHei', 'Heiti SC', 'Microsoft YaHei', 'PingFang SC', sans-serif";

export class GlyphAtlas {
  /** 纹理会在扩容时重建，因此非只读 */
  texture: Texture2d;
  readonly sampler: GPUSampler;
  readonly fontSizePx: number;
  readonly lineHeight: number;

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
      textureWidthPx = 512,
      textureHeightPx = 512,
      paddingPx = 2,
    } = options;

    this.device = device;
    this.fontSizePx = fontSizePx;
    this.lineHeight = Math.ceil(fontSizePx * 1.25);
    this.paddingPx = paddingPx;
    this.font = `${fontSizePx}px ${fontFamily}`;
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

    this.texture = createTextureFromBitmap(device, this.canvas, 'glyph-atlas');
    this.sampler = createTextureSampler(device, 'glyph-atlas-sampler');
  }

  /** 取字形；首次访问才烘焙。图集满时返回 undefined（调用方可换新图集实例） */
  getGlyph(char: string): GlyphEntry | undefined {
    const cached = this.glyphs.get(char);
    if (cached) return cached;

    const metrics = this.ctx.measureText(char);
    const advance = Math.max(metrics.width, 1);
    const ascent = Math.ceil(metrics.actualBoundingBoxAscent || this.fontSizePx * 0.8);
    const descent = Math.ceil(metrics.actualBoundingBoxDescent || this.fontSizePx * 0.2);
    const cellWidth = Math.ceil(advance) + this.paddingPx * 2;
    const cellHeight = ascent + descent + this.paddingPx * 2;

    // 图集满：扩容一页（尺寸翻倍、保留已烘焙字形），再重新分配
    let slot = this.allocate(cellWidth, cellHeight);
    if (!slot) {
      this.grow();
      slot = this.allocate(cellWidth, cellHeight);
    }
    if (!slot) return undefined;

    // 画进格子：基线 = 顶部 padding + ascent
    this.ctx.fillText(char, slot.x + this.paddingPx, slot.y + this.paddingPx + ascent);
    // 只把这一小块写进图集纹理，不重建整张纹理
    const image = this.ctx.getImageData(slot.x, slot.y, cellWidth, cellHeight);
    this.device.queue.writeTexture(
      { texture: this.texture.texture, origin: [slot.x, slot.y] },
      image.data,
      { bytesPerRow: cellWidth * 4 },
      [cellWidth, cellHeight],
    );

    const entry: GlyphEntry = {
      x: slot.x,
      y: slot.y,
      advance,
      cellWidth,
      cellHeight,
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
