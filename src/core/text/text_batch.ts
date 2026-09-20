/**
 * 文字排版：把字符串按字素簇排成实例数组，交给核心实例化通路绘制。
 *
 * 每个字一个实例：格子尺寸 → 世界尺寸（除以相机缩放），图集 uv 写进 atlasUvRect，
 * 因此整段文字仍然只是一次 draw call。注册到 RENDER_LAYER.overlay 即可叠在图元之上。
 *
 * 两个已知待办（需要探针确认后再定，见文件末尾注释）：
 *   1. 垂直方向：画布 y 向下，正交相机又翻转了 y，v 轴是否正确需要像素验证
 *   2. 颜色：核心矩形的颜色目前写死在着色器里，逐实例颜色需要再扩实例字段
 */
import type { GlyphAtlas } from '@/core/text/glyph_atlas';
import { splitGraphemes } from '@/core/text/glyph_atlas';
import type { RectInstance } from '@/core/types';

export interface TextLayoutOptions {
  /** 文字左上角（世界坐标，y 向下） */
  x: number;
  y: number;
  /** 相机缩放：1 世界单位对应多少屏幕像素，用来把字形像素换算成世界尺寸 */
  pixelsPerWorldUnit: number;
  /** 字距（像素） */
  letterSpacingPx?: number;
  /** 文字颜色 (r,g,b,a)，默认近白，避免与灰色图元糊在一起 */
  color?: readonly [number, number, number, number];
  /**
   * 文字底板（可选）：在文字下方铺一块半透明矩形。
   * 默认关闭；需要保证压在浅色图元上也能看清时再传颜色开启。
   */
  backdrop?: readonly [number, number, number, number] | false;
  /** 底板相对文字的外扩（像素） */
  backdropPaddingPx?: number;
}

export interface TextLayoutResult {
  instances: RectInstance[];
  /** 排版后的总宽度（世界单位） */
  width: number;
  /** 图集里缺失、本次被跳过的字 */
  missing: string[];
}

/**
 * 排版一行文字
 * @param atlas 字形图集（一张图集对应一套字体与字号）
 */
export function layoutText(
  atlas: GlyphAtlas,
  text: string,
  options: TextLayoutOptions,
): TextLayoutResult {
  const {
    x,
    y,
    pixelsPerWorldUnit,
    letterSpacingPx = 0,
    color = [0.93, 0.95, 0.98, 1] as const,
    backdrop = false as const,
    backdropPaddingPx = 3,
  } = options;
  const worldPerPixel = 1 / Math.max(pixelsPerWorldUnit, 1e-6);
  const instances: RectInstance[] = [];
  const missing: string[] = [];

  // 底板：宽度先用排版结果算，等排完再插到最前面（保证文字压在底板上）
  const backdropInstances: RectInstance[] = [];
  let cursorX = x;
  for (const grapheme of splitGraphemes(text)) {
    const glyph = atlas.getGlyph(grapheme);
    if (!glyph) {
      missing.push(grapheme);
      continue;
    }

    const worldWidth = glyph.cellWidth * worldPerPixel;
    const worldHeight = glyph.cellHeight * worldPerPixel;
    instances.push({
      // 实例是中心点对齐，格子左上角在 (cursorX, y)
      tx: cursorX + worldWidth / 2,
      ty: y + worldHeight / 2,
      sx: worldWidth,
      sy: worldHeight,
      beta: 0,
      selected: 0,
      // uv 按图集当前尺寸换算（图集扩容后旧字形依然正确）
      u0: glyph.x / atlas.texture.width,
      v0: glyph.y / atlas.texture.height,
      u1: (glyph.x + glyph.cellWidth) / atlas.texture.width,
      v1: (glyph.y + glyph.cellHeight) / atlas.texture.height,
      colorR: color[0],
      colorG: color[1],
      colorB: color[2],
      colorA: color[3],
    });
    cursorX += (glyph.advance + letterSpacingPx) * worldPerPixel;
  }

  const width = cursorX - x;
  if (backdrop && instances.length > 0) {
    const padWorld = backdropPaddingPx * worldPerPixel;
    const heightWorld = atlas.lineHeight * worldPerPixel + padWorld * 2;
    backdropInstances.push({
      tx: x + width / 2,
      ty: y + atlas.lineHeight * worldPerPixel * 0.5,
      sx: width + padWorld * 2,
      sy: heightWorld,
      beta: 0,
      selected: 0,
      // 整张纹理（白）→ 颜色完全由逐实例颜色决定
      u0: 0,
      v0: 0,
      u1: 1,
      v1: 1,
      colorR: backdrop[0],
      colorG: backdrop[1],
      colorB: backdrop[2],
      colorA: backdrop[3],
    });
  }

  return { instances: [...backdropInstances, ...instances], width, missing };
}
