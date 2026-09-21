/**
 * 文字排版：把字符串按字素簇排成 `Graphic` 数组，交给核心实例化通路绘制。
 *
 * 每个字一个图形：位置是世界坐标、尺寸按屏幕像素（`sizeUnit = 'screen'`），
 * 图集 uv 写进 `atlasUvRect`，装箱走 `Graphic#toInstance`，
 * 因此整段文字仍然只是一次 draw call。注册到 RENDER_LAYER.overlay 即可叠在图元之上。
 *
 * 已知待办：垂直方向——画布 y 向下，正交相机又翻转了 y，v 轴是否正确需要像素验证
 */
import type { GlyphAtlas } from '@/core/text/glyph_atlas';
import { splitGraphemes } from '@/core/text/glyph_atlas';
import { Graphic } from '@/core/scene/graphic';

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
  /**
   * 文字描边（label halo）：先按四个方向偏移画描边色，再画主色。
   * 压在任意图元上都可读，且比底板更贴合字形。默认关闭。
   */
  outline?: { color: readonly [number, number, number, number]; widthPx?: number } | false;
}

export interface TextLayoutResult {
  /** 排版结果：每字一个图形（含可选底板与描边），顺序为「底板 → 描边 → 主色」 */
  graphics: Graphic[];
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
    outline = false as const,
  } = options;
  const worldPerPixel = 1 / Math.max(pixelsPerWorldUnit, 1e-6);
  const glyphGraphics: Graphic[] = [];
  const missing: string[] = [];

  // 底板：宽度先用排版结果算，等排完再插到最前面（保证文字压在底板上）
  const backdropGraphics: Graphic[] = [];
  const outlineGraphics: Graphic[] = [];
  let cursorX = x;
  for (const grapheme of splitGraphemes(text)) {
    const glyph = atlas.getGlyph(grapheme);
    if (!glyph) {
      missing.push(grapheme);
      continue;
    }

    const worldWidth = glyph.cellWidth * worldPerPixel;
    const worldHeight = glyph.cellHeight * worldPerPixel;
    glyphGraphics.push(
      new Graphic({
        // 实例是中心点对齐，格子左上角在 (cursorX, y)
        id: glyphGraphics.length,
        x: cursorX + worldWidth / 2,
        y: y + worldHeight / 2,
        fillColor: color,
      })
        // 格子尺寸就是屏幕像素：贴到画布上视觉大小恒定
        .screenSize(glyph.cellWidth, glyph.cellHeight)
        // uv 按图集当前尺寸换算（图集扩容后旧字形依然正确）
        .atlasUv([
          glyph.x / atlas.texture.width,
          glyph.y / atlas.texture.height,
          (glyph.x + glyph.cellWidth) / atlas.texture.width,
          (glyph.y + glyph.cellHeight) / atlas.texture.height,
        ]),
    );
    cursorX += (glyph.advance + letterSpacingPx) * worldPerPixel;
  }

  const width = cursorX - x;

  // 描边：把主色字形按上下左右各偏一点、用描边色先画一遍
  if (outline && glyphGraphics.length > 0) {
    const offset = (outline.widthPx ?? 1) / Math.max(pixelsPerWorldUnit, 1e-6);
    const offsets: ReadonlyArray<readonly [number, number]> = [
      [-offset, 0],
      [offset, 0],
      [0, -offset],
      [0, offset],
    ];
    for (const glyph of glyphGraphics) {
      for (const [dx, dy] of offsets) {
        outlineGraphics.push(
          new Graphic({
            id: outlineGraphics.length,
            x: glyph.x + dx,
            y: glyph.y + dy,
            fillColor: outline.color,
          })
            .screenSize(glyph.width, glyph.height)
            .atlasUv(glyph.atlasUvRect),
        );
      }
    }
  }
  if (backdrop && glyphGraphics.length > 0) {
    // 底板的宽度是世界单位，这里换算回「屏幕像素」口径（外扩本来就是像素）
    const padPx = backdropPaddingPx;
    backdropGraphics.push(
      new Graphic({
        id: 0,
        x: x + width / 2,
        y: y + atlas.lineHeight * worldPerPixel * 0.5,
        fillColor: backdrop,
      }).screenSize(width * pixelsPerWorldUnit + padPx * 2, atlas.lineHeight + padPx * 2),
    );
  }

  return {
    graphics: [...backdropGraphics, ...outlineGraphics, ...glyphGraphics],
    width,
    missing,
  };
}
