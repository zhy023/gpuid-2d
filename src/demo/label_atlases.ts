/**
 * 位号图集缓存：一张图集只服务「一套字体 + 一个字号 + 一个行高倍率」，
 * 缓存键是这三者的组合——图纸换了字体（fontFamily）就必须换图集，
 * 否则字宽、行距都还是按旧字体量的。缺则新建；
 * 图纸里字号通常只有两三档，所以分组后 draw call 依然常数级。
 */
import {
  DEFAULT_FONT_FAMILY,
  DEFAULT_LINE_HEIGHT_RATIO,
  GlyphAtlas,
} from '@/core/text/glyph_atlas';

export interface LabelAtlasOptions {
  /** 字体（图纸的 fontFamily；缺省用核心默认的回退链） */
  fontFamily?: string;
  /** 行高倍率（图纸的 lineHeight；缺省 1.2） */
  lineHeightRatio?: number;
}

export class LabelAtlasCache {
  private readonly device: GPUDevice;
  private readonly atlases = new Map<string, GlyphAtlas>();

  constructor(device: GPUDevice) {
    this.device = device;
  }

  get(fontSizePx: number, options: LabelAtlasOptions = {}): GlyphAtlas {
    const size = Math.max(8, Math.round(fontSizePx));
    const fontFamily = options.fontFamily ?? DEFAULT_FONT_FAMILY;
    const lineHeightRatio = options.lineHeightRatio ?? DEFAULT_LINE_HEIGHT_RATIO;
    const key = `${size}|${lineHeightRatio}|${fontFamily}`;
    const existing = this.atlases.get(key);
    if (existing) return existing;

    const atlas = new GlyphAtlas(this.device, { fontSizePx: size, fontFamily, lineHeightRatio });
    this.atlases.set(key, atlas);
    return atlas;
  }

  get size(): number {
    return this.atlases.size;
  }

  dispose(): void {
    for (const atlas of this.atlases.values()) atlas.texture.texture.destroy();
    this.atlases.clear();
  }
}
