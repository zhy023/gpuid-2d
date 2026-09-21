/**
 * 位号图集缓存：按字号取图集（一张图集只服务一套字体 + 字号），缺则新建。
 * 图纸里字号通常只有两三档，所以按字号分组后 draw call 依然常数级。
 */
import { GlyphAtlas } from '@/core/text/glyph_atlas';

export class LabelAtlasCache {
  private readonly device: GPUDevice;
  private readonly atlases = new Map<number, GlyphAtlas>();

  constructor(device: GPUDevice) {
    this.device = device;
  }

  get(fontSizePx: number): GlyphAtlas {
    const size = Math.max(8, Math.round(fontSizePx));
    const existing = this.atlases.get(size);
    if (existing) return existing;

    const atlas = new GlyphAtlas(this.device, { fontSizePx: size });
    this.atlases.set(size, atlas);
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
