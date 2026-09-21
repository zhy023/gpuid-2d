/**
 * 示例所需的 GPU 资源：字形图集（位号 + 标题）与阀门开关贴图。
 * 只负责创建，绘制在 frame 阶段使用。
 */
import { createTextureSampler, loadTextureFromUrl, type Texture2d } from '@/core/gpu/texture';
import { GlyphAtlas } from '@/core/text/glyph_atlas';

export interface DemoResources {
  /** 位号用的小字号图集 */
  glyphAtlas: GlyphAtlas;
  /** 标题用的大字号图集 */
  titleAtlas: GlyphAtlas;
  /** 阀门关闭态贴图 */
  valveOffTexture: Texture2d;
  /** 阀门开启态贴图；资源缺失时为 null，绘制端退化为关闭态贴图 */
  valveOnTexture: Texture2d | null;
  /** 阀门贴图采样器 */
  valveSampler: GPUSampler;
  /** 阀门贴图原始像素尺寸（@2x，绘制时按一半落地） */
  valveTextureWidth: number;
  valveTextureHeight: number;
}

/** 阀门开关两态贴图（图纸里的阀门单元内联的就是这两张 PNG，图纸翻译层按它识别阀门） */
export const VALVE_OFF_URL = '/assets/famen_off@2x.png';
export const VALVE_ON_URL = '/assets/famen_on@2x.png';

export async function createDemoResources(device: GPUDevice): Promise<DemoResources> {
  const glyphAtlas = new GlyphAtlas(device, { fontSizePx: 18 });
  const titleAtlas = new GlyphAtlas(device, { fontSizePx: 32 });

  const valveOffTexture = await loadTextureFromUrl(device, VALVE_OFF_URL, 'valve-sprite');

  /** 开启态贴图缺失时退化为关闭态，保证应用仍能启动 */
  let valveOnTexture: Texture2d | null = null;
  try {
    valveOnTexture = await loadTextureFromUrl(device, VALVE_ON_URL, 'valve-sprite-on');
  } catch {
    console.warn(`[gpuid] 未找到 ${VALVE_ON_URL}，阀门开启态暂用关闭态贴图`);
  }

  return {
    glyphAtlas,
    titleAtlas,
    valveOffTexture,
    valveOnTexture,
    valveSampler: createTextureSampler(device, 'valve-sprite-sampler'),
    valveTextureWidth: valveOffTexture.width,
    valveTextureHeight: valveOffTexture.height,
  };
}
