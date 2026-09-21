/**
 * 文字排版用例：用假图集（不依赖 canvas / WebGPU）验证
 * advance 累进、基线对齐、行盒/行距、对齐锚点、图集 uv 透传、缺字收集、字素切分。
 * 排版产出的是 `Graphic`（尺寸按屏幕像素），世界尺寸由 `toInstance()` 按缩放折算。
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { splitGraphemes, type GlyphAtlas, type GlyphEntry } from '@/core/text/glyph_atlas';
import { layoutText, layoutTextBlock, measureTextLine } from '@/core/text/text_batch';

/**
 * 假图集：每字格子 10×12、advance 8、基线在格子顶下方 10px，uv 依次占 0.1 宽。
 * 行盒 12 = ascent 10 + descent 2，所以半行距为 0，基线正好落在行盒顶下方 10px——
 * 格子顶边 = y，与「按行盒顶排版」的老口径视觉一致，方便对照断言。
 */
function makeFakeAtlas(characters: string): GlyphAtlas {
  const glyphs = new Map<string, GlyphEntry>();
  [...characters].forEach((char, index) => {
    glyphs.set(char, {
      /* 条目存像素矩形；uv 由 layoutText 按图集尺寸换算 */
      x: index * 10,
      y: 0,
      advance: 8,
      cellWidth: 10,
      cellHeight: 12,
      baselineOffset: 10,
    });
  });
  return {
    glyphs,
    lineHeight: 12,
    lineHeightRatio: 1.2,
    fontSizePx: 10,
    ascentPx: 10,
    descentPx: 2,
    /* 图集纹理尺寸：100×20，于是第 n 个格子的 u 区间仍是 [n/10, (n+1)/10] */
    texture: { width: 100, height: 20 },
    getGlyph: (char: string) => glyphs.get(char),
  } as unknown as GlyphAtlas;
}

/** 由图形反推基线 y：图形中心 + (格子高/2 - 格子顶到基线的距离) */
function baselineOf(graphic: { y: number; height: number }, baselineOffset: number): number {
  return graphic.y - graphic.height / 2 + baselineOffset;
}

describe('layoutText', () => {
  it('按 advance 累进，并把图集 uv 写进图形', () => {
    const atlas = makeFakeAtlas('你好');
    const result = layoutText(atlas, '你好', { x: 0, y: 0, pixelsPerWorldUnit: 1 });

    assert.equal(result.graphics.length, 2, '两个字应产生两个图形');
    assert.equal(result.missing.length, 0);
    assert.equal(result.width, 16, '总宽 = 2 × advance');

    const [first, second] = result.graphics;
    /* 实例是中心点对齐：格子左上角在 x=0 / x=8 */
    assert.equal(first.x, 5);
    assert.equal(second.x, 13);
    assert.equal(first.width, 10, '尺寸按屏幕像素存');
    assert.equal(first.height, 12);
    assert.equal(first.sizeUnit, 'screen');
    /* uv 分别来自两个字，且互不重叠 */
    assert.deepEqual([first.atlasUvRect[0], first.atlasUvRect[2]], [0, 0.1]);
    assert.deepEqual([second.atlasUvRect[0], second.atlasUvRect[2]], [0.1, 0.2]);
    assert.ok(first.atlasUvRect[2] <= second.atlasUvRect[0], '相邻字的 uv 不应重叠');
  });

  it('文字颜色与尺寸按相机缩放换算', () => {
    const atlas = makeFakeAtlas('你');
    const zoomedOut = layoutText(atlas, '你', {
      x: 0,
      y: 0,
      pixelsPerWorldUnit: 0.5,
      color: [1, 0, 0, 1],
    });
    const [glyph] = zoomedOut.graphics;
    const instance = glyph.toInstance(0.5);
    assert.equal(instance.sx, 20, '像素 ÷ 缩放 = 世界尺寸');
    assert.equal(instance.sy, 24);
    assert.equal(instance.colorR, 1);
    assert.equal(instance.colorA, 1);
  });

  it('缺失字形进入 missing，且不占排版位置', () => {
    const atlas = makeFakeAtlas('你');
    const result = layoutText(atlas, '你好', { x: 0, y: 0, pixelsPerWorldUnit: 1 });

    assert.deepEqual(result.missing, ['好']);
    assert.equal(result.graphics.length, 1);
    assert.equal(result.width, 8, '缺字不推进光标');
  });

  it('量宽与排版同口径（缺字不占宽）', () => {
    const atlas = makeFakeAtlas('A');
    const measured = measureTextLine(atlas, 'A好', { pixelsPerWorldUnit: 1 });

    assert.equal(measured.width, 8);
    assert.deepEqual(measured.missing, ['好']);
  });

  it('同一行的字共用一条基线，而不是各按自己的墨迹居中', () => {
    /** 一个字只有 x 高度，另一个带降部（格子更高、顶边离基线更远） */
    const glyphs = new Map<string, GlyphEntry>([
      ['H', { x: 0, y: 0, advance: 8, cellWidth: 10, cellHeight: 12, baselineOffset: 10 }],
      ['g', { x: 10, y: 0, advance: 8, cellWidth: 10, cellHeight: 14, baselineOffset: 12 }],
    ]);
    const atlas = {
      glyphs,
      lineHeight: 12,
      ascentPx: 10,
      descentPx: 2,
      texture: { width: 100, height: 20 },
      getGlyph: (char: string) => glyphs.get(char),
    } as unknown as GlyphAtlas;

    const { graphics } = layoutText(atlas, 'Hg', { x: 0, y: 0, pixelsPerWorldUnit: 1 });
    const [cap, descender] = graphics;

    /* 行盒 12 = ascent 10 + descent 2，半行距 0 → 基线在行盒顶下方 10px */
    assert.equal(baselineOf(cap, 10), 10);
    assert.equal(baselineOf(descender, 12), 10, '降部字的基线要和字母同高');
    assert.notEqual(descender.y, cap.y, '降部字的格子要整体上抬，才不是按墨迹居中');
  });

  it('默认不铺底板；开启后底板排在文字之前', () => {
    const atlas = makeFakeAtlas('你');
    const withoutBackdrop = layoutText(atlas, '你', { x: 0, y: 0, pixelsPerWorldUnit: 1 });
    assert.equal(withoutBackdrop.graphics.length, 1);

    const withBackdrop = layoutText(atlas, '你', {
      x: 0,
      y: 0,
      pixelsPerWorldUnit: 1,
      backdrop: [0, 0, 0, 0.5],
    });
    assert.equal(withBackdrop.graphics.length, 2);
    const [backdrop, glyph] = withBackdrop.graphics;
    assert.equal(backdrop.atlasUvRect[0], 0, '底板用整张纹理');
    assert.equal(backdrop.atlasUvRect[2], 1);
    assert.equal(backdrop.fillColor?.[3], 0.5, '底板半透明');
    assert.equal(backdrop.width > glyph.width, true, '底板比文字宽');
  });
});

describe('layoutTextBlock', () => {
  it('行盒按图集行高排布，整块垂直居中于锚点', () => {
    const atlas = makeFakeAtlas('AB');
    const block = layoutTextBlock(atlas, 'A\nB', {
      x: 0,
      y: 100,
      pixelsPerWorldUnit: 1,
      verticalAlign: 'middle',
    });

    assert.equal(block.lines, 2);
    assert.equal(block.lineHeight, 12, '行距 = 图集行高');
    /* 整块高 2 × 12 = 24，围绕 y = 100 居中 → 两行行盒顶分别在 88 / 100 */
    assert.equal(block.graphics[0].y, 94);
    assert.equal(block.graphics[1].y, 106);
  });

  it('水平按锚点对齐（居中 / 右对齐）', () => {
    const atlas = makeFakeAtlas('AB');
    const centered = layoutTextBlock(atlas, 'AB', {
      x: 0,
      y: 0,
      pixelsPerWorldUnit: 1,
      align: 'center',
    });
    /* 宽 16 → 居中的行左边界在 -8 */
    assert.equal(centered.graphics[0].x, -3);
    assert.equal(centered.graphics[1].x, 5);

    const right = layoutTextBlock(atlas, 'AB', {
      x: 0,
      y: 0,
      pixelsPerWorldUnit: 1,
      align: 'right',
    });
    assert.equal(right.graphics[1].x, -3);
  });

  it('换行只认输入里的 \\n：块宽取最长一行，缺字逐行汇总', () => {
    const atlas = makeFakeAtlas('AB');
    const block = layoutTextBlock(atlas, 'AB\nA好', { x: 0, y: 0, pixelsPerWorldUnit: 1 });

    assert.equal(block.lines, 2);
    assert.equal(block.width, 16);
    assert.equal(block.graphics.length, 3);
    assert.deepEqual(block.missing, ['好']);
  });
});

describe('splitGraphemes', () => {
  it('中文按字切分', () => {
    assert.deepEqual(splitGraphemes('你好'), ['你', '好']);
  });

  it('数字与字母不被拆开', () => {
    assert.deepEqual(splitGraphemes('V101'), ['V', '1', '0', '1']);
  });

  it('emoji 组合（ZWJ 序列）视为一个字素', () => {
    assert.equal(splitGraphemes('👨‍👩‍👧').length, 1);
  });
});
