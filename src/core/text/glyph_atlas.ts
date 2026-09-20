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

export interface GlyphEntry {
  /** 图集 uv 矩形 */
  u0: number;
  v0: number;
  u1: number;
  v1: number;
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

export class GlyphAtlas {
  readonly texture: Texture2d;
  readonly fontSizePx: number;
  readonly lineHeight: number;

  private readonly device: GPUDevice;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly canvas: HTMLCanvasElement | OffscreenCanvas;
  private readonly paddingPx: number;
  private readonly glyphs = new Map<string, GlyphEntry>();
  // shelf 打包游标
  private cursorX = 0;
  private cursorY = 0;
  private shelfHeight = 0;

  constructor(device: GPUDevice, options: GlyphAtlasOptions = {}) {
    const {
      fontFamily = 'sans-serif',
      fontSizePx = 16,
      textureWidthPx = 512,
      textureHeightPx = 512,
      paddingPx = 2,
    } = options;

    this.device = device;
    this.fontSizePx = fontSizePx;
    this.lineHeight = Math.ceil(fontSizePx * 1.25);
    this.paddingPx = paddingPx;
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
    this.ctx.font = `${fontSizePx}px ${fontFamily}`;
    this.ctx.textAlign = 'left';
    this.ctx.textBaseline = 'alphabetic';
    this.ctx.fillStyle = '#ffffff';

    this.texture = createTextureFromBitmap(device, this.canvas, 'glyph-atlas');
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

    const slot = this.allocate(cellWidth, cellHeight);
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
      u0: slot.x / this.texture.width,
      v0: slot.y / this.texture.height,
      u1: (slot.x + cellWidth) / this.texture.width,
      v1: (slot.y + cellHeight) / this.texture.height,
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
