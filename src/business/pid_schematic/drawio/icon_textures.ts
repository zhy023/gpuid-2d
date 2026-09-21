/**
 * 图纸图标纹理缓存：mxCell 里的内联 base64 图标 → 纹理。
 *
 * 同一个 dataURL 只加载一次（图纸里几十个图标去重后通常只有十几个图案）；
 * 加载是异步的，未就绪时 `get()` 返回 null，绘制端跳过该批次，下一帧自动出现。
 */
import { createTextureSampler, loadTextureFromUrl, type Texture2d } from '@/core/gpu/texture';

export class IconTextureCache {
  private readonly device: GPUDevice;
  private readonly textures = new Map<string, Texture2d>();
  private readonly pending = new Set<string>();
  readonly sampler: GPUSampler;

  constructor(device: GPUDevice) {
    this.device = device;
    this.sampler = createTextureSampler(device, 'icon-sampler');
  }

  /** 取图标纹理；未加载过则触发异步加载并返回 null */
  get(url: string): Texture2d | null {
    const cached = this.textures.get(url);
    if (cached) return cached;

    if (!this.pending.has(url)) {
      this.pending.add(url);
      void loadTextureFromUrl(this.device, url, 'drawio-icon')
        .then((texture) => {
          this.textures.set(url, texture);
        })
        .catch((error: unknown) => {
          console.warn('[gpuid] 图标纹理加载失败：', error);
        })
        .finally(() => {
          this.pending.delete(url);
        });
    }
    return null;
  }

  get loadedCount(): number {
    return this.textures.size;
  }

  dispose(): void {
    for (const texture of this.textures.values()) texture.texture.destroy();
    this.textures.clear();
    this.pending.clear();
  }
}
