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
  const { x, y, pixelsPerWorldUnit, letterSpacingPx = 0 } = options;
  const worldPerPixel = 1 / Math.max(pixelsPerWorldUnit, 1e-6);
  const instances: RectInstance[] = [];
  const missing: string[] = [];

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
      u0: glyph.u0,
      v0: glyph.v0,
      u1: glyph.u1,
      v1: glyph.v1,
    });
    cursorX += (glyph.advance + letterSpacingPx) * worldPerPixel;
  }

  return { instances, width: cursorX - x, missing };
}
