/**
 * 文字排版：把字符串按字素簇排成 `Graphic` 数组，交给核心实例化通路绘制。
 *
 * 排版口径与「图纸 / 浏览器」对齐，这是复刻图纸版式的三件要紧事：
 *   - 行盒高 = 图集的行高（`fontSizePx × lineHeightRatio`，drawio 默认 1.2）；
 *   - 一行里所有字共用一条基线：基线 = 行盒顶 + 半行距 + 字体 ascent（同 CSS strut 口径），
 *     所以数字、括号、带降部的字母不会各按自己的墨迹居中，多行之间的行距才稳定；
 *   - 换行只认排版输入里的 `\n`（图纸的 `<div>` / `<br>` 由解析层折成它），排版器不擅自折行。
 *
 * 每个字一个图形：位置是世界坐标、尺寸按屏幕像素（`sizeUnit = 'screen'`），
 * 图集 uv 写进 `atlasUvRect`，装箱走 `Graphic#toInstance`，
 * 因此整段文字仍然只是一次 draw call。注册到 RENDER_LAYER.overlay 即可叠在图元之上。
 */
import type { GlyphAtlas } from '@/core/text/glyph_atlas';
import { splitGraphemes } from '@/core/text/glyph_atlas';
import { Graphic } from '@/core/scene/graphic/graphic';

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

/** 水平对齐：锚点 x 落在文字的哪一侧 */
export type TextAlign = 'left' | 'center' | 'right';
/**
 * 垂直锚：`top` 时 y 是整块顶边；`middle` 时 y 是整块垂直中心
 * （drawio 的 `align-items: unsafe center` 就是后者）。
 */
export type TextVerticalAlign = 'top' | 'middle';

export interface TextBlockOptions extends Omit<TextLayoutOptions, 'x' | 'y'> {
  /** 锚点 x：按 align 对齐到这里 */
  x: number;
  /** 锚点 y：按 verticalAlign 对齐到这里 */
  y: number;
  /** 水平对齐，默认左对齐（drawio 的 align=left） */
  align?: TextAlign;
  /** 垂直对齐，默认 top */
  verticalAlign?: TextVerticalAlign;
}

export interface TextBlockResult extends TextLayoutResult {
  /** 行数（空行也算一行） */
  lines: number;
  /** 行距 / 行盒高（世界单位） */
  lineHeight: number;
}

/**
 * 量一行文字：只累进 advance，不建图形（缺字既不推进光标、也不占宽度）。
 * 换行、居中、折行判断都用它——量宽与排版必须是同一份实现，否则版式对不上。
 */
export function measureTextLine(
  atlas: GlyphAtlas,
  text: string,
  options: Pick<TextLayoutOptions, 'pixelsPerWorldUnit' | 'letterSpacingPx'>,
): { width: number; missing: string[] } {
  const { pixelsPerWorldUnit, letterSpacingPx = 0 } = options;
  const worldPerPixel = 1 / Math.max(pixelsPerWorldUnit, 1e-6);
  const missing: string[] = [];
  let cursorPx = 0;
  for (const grapheme of splitGraphemes(text)) {
    const glyph = atlas.getGlyph(grapheme);
    if (!glyph) {
      missing.push(grapheme);
      continue;
    }
    cursorPx += glyph.advance + letterSpacingPx;
  }
  return { width: cursorPx * worldPerPixel, missing };
}

/**
 * 排版一行文字（x / y 是这一行的行盒左上角）
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

  /** 底板：宽度先用排版结果算，等排完再插到最前面（保证文字压在底板上） */
  const backdropGraphics: Graphic[] = [];
  const outlineGraphics: Graphic[] = [];

  /** 基线：行盒顶 + 半行距 + 字体 ascent；同一行的所有字都挂在这一条线上 */
  const halfLeading = (atlas.lineHeight - (atlas.ascentPx + atlas.descentPx)) / 2;
  const baselineY = y + halfLeading + atlas.ascentPx;

  let cursorX = x;
  for (const grapheme of splitGraphemes(text)) {
    const glyph = atlas.getGlyph(grapheme);
    if (!glyph) continue;

    const worldWidth = glyph.cellWidth * worldPerPixel;
    const worldHeight = glyph.cellHeight * worldPerPixel;
    /** 格子顶边 = 基线往上退「这个字到基线的距离」，所有字共用基线 */
    const cellTop = baselineY - glyph.baselineOffset * worldPerPixel;
    glyphGraphics.push(
      new Graphic({
        /* 实例是中心点对齐，格子左上角在 (cursorX, y) */
        id: glyphGraphics.length,
        x: cursorX + worldWidth / 2,
        y: cellTop + worldHeight / 2,
        fillColor: color,
      })
        /* 格子尺寸就是屏幕像素：贴到画布上视觉大小恒定 */
        .screenSize(glyph.cellWidth, glyph.cellHeight)
        /* uv 按图集当前尺寸换算（图集扩容后旧字形依然正确） */
        .atlasUv([
          glyph.x / atlas.texture.width,
          glyph.y / atlas.texture.height,
          (glyph.x + (glyph.rasterWidth ?? glyph.cellWidth)) / atlas.texture.width,
          (glyph.y + (glyph.rasterHeight ?? glyph.cellHeight)) / atlas.texture.height,
        ]),
    );
    cursorX += (glyph.advance + letterSpacingPx) * worldPerPixel;
  }

  const measured = measureTextLine(atlas, text, { pixelsPerWorldUnit, letterSpacingPx });
  const width = measured.width;

  /** 描边：把主色字形按上下左右各偏一点、用描边色先画一遍 */
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
    /** 底板的宽度是世界单位，这里换算回「屏幕像素」口径（外扩本来就是像素） */
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
    missing: measured.missing,
  };
}

/**
 * 排版多行文字：换行只由输入里的 `\n` 决定（图纸的 `<div>` / `<br>` 已在解析层折成它）。
 * 整块高度 = 行数 × 行高；水平按 align 对齐到锚点 x，垂直按 verticalAlign 对齐到锚点 y。
 */
export function layoutTextBlock(
  atlas: GlyphAtlas,
  text: string,
  options: TextBlockOptions,
): TextBlockResult {
  const { align = 'left', verticalAlign = 'top', x, y, pixelsPerWorldUnit } = options;
  const lineOptions: TextLayoutOptions = { ...options, x, y };
  const lines = text.split('\n');
  const worldPerPixel = 1 / Math.max(pixelsPerWorldUnit, 1e-6);
  const lineHeight = atlas.lineHeight * worldPerPixel;
  const blockTop = verticalAlign === 'middle' ? y - (lineHeight * lines.length) / 2 : y;

  const graphics: Graphic[] = [];
  const missing: string[] = [];
  let width = 0;
  lines.forEach((line, index) => {
    const measured = measureTextLine(atlas, line, lineOptions);
    width = Math.max(width, measured.width);
    const lineX =
      align === 'center' ? x - measured.width / 2 : align === 'right' ? x - measured.width : x;
    const laidOut = layoutText(atlas, line, {
      ...lineOptions,
      x: lineX,
      y: blockTop + index * lineHeight,
    });
    graphics.push(...laidOut.graphics);
    missing.push(...laidOut.missing);
  });

  return { graphics, width, missing, lines: lines.length, lineHeight };
}
