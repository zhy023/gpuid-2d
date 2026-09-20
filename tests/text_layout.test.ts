/**
 * 文字排版用例：用假图集（不依赖 canvas / WebGPU）验证
 * advance 累进、图集 uv 透传、缺字收集、字素切分。
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { splitGraphemes, type GlyphAtlas, type GlyphEntry } from '@/core/text/glyph_atlas';
import { layoutText } from '@/core/text/text_batch';

/** 假图集：每字格子 10×12、advance 8，uv 依次占 0.1 宽 */
function makeFakeAtlas(characters: string): GlyphAtlas {
  const glyphs = new Map<string, GlyphEntry>();
  [...characters].forEach((char, index) => {
    glyphs.set(char, {
      u0: index * 0.1,
      v0: 0,
      u1: (index + 1) * 0.1,
      v1: 0.2,
      advance: 8,
      cellWidth: 10,
      cellHeight: 12,
    });
  });
  return {
    glyphs,
    lineHeight: 12,
    fontSizePx: 10,
    getGlyph: (char: string) => glyphs.get(char),
  } as unknown as GlyphAtlas;
}

describe('layoutText', () => {
  it('按 advance 累进，并把图集 uv 写进实例', () => {
    const atlas = makeFakeAtlas('你好');
    const result = layoutText(atlas, '你好', { x: 0, y: 0, pixelsPerWorldUnit: 1 });

    assert.equal(result.instances.length, 2, '两个字应产生两个实例');
    assert.equal(result.missing.length, 0);
    assert.equal(result.width, 16, '总宽 = 2 × advance');

    const [first, second] = result.instances;
    // 实例是中心点对齐：格子左上角在 x=0 / x=8
    assert.equal(first.tx, 5);
    assert.equal(second.tx, 13);
    assert.equal(first.sx, 10);
    assert.equal(first.sy, 12);
    // uv 分别来自两个字，且互不重叠
    assert.deepEqual([first.u0, first.u1], [0, 0.1]);
    assert.deepEqual([second.u0, second.u1], [0.1, 0.2]);
    assert.ok(first.u1 <= second.u0, '相邻字的 uv 不应重叠');
  });

  it('文字颜色与尺寸按相机缩放换算', () => {
    const atlas = makeFakeAtlas('你');
    const zoomedOut = layoutText(atlas, '你', {
      x: 0,
      y: 0,
      pixelsPerWorldUnit: 0.5,
      color: [1, 0, 0, 1],
    });
    const [instance] = zoomedOut.instances;
    assert.equal(instance.sx, 20, '像素 ÷ 缩放 = 世界尺寸');
    assert.equal(instance.sy, 24);
    assert.equal(instance.colorR, 1);
    assert.equal(instance.colorA, 1);
  });

  it('缺失字形进入 missing，且不占排版位置', () => {
    const atlas = makeFakeAtlas('你');
    const result = layoutText(atlas, '你好', { x: 0, y: 0, pixelsPerWorldUnit: 1 });

    assert.deepEqual(result.missing, ['好']);
    assert.equal(result.instances.length, 1);
    assert.equal(result.width, 8, '缺字不推进光标');
  });

  it('默认不铺底板；开启后底板排在文字之前', () => {
    const atlas = makeFakeAtlas('你');
    const withoutBackdrop = layoutText(atlas, '你', { x: 0, y: 0, pixelsPerWorldUnit: 1 });
    assert.equal(withoutBackdrop.instances.length, 1);

    const withBackdrop = layoutText(atlas, '你', {
      x: 0,
      y: 0,
      pixelsPerWorldUnit: 1,
      backdrop: [0, 0, 0, 0.5],
    });
    assert.equal(withBackdrop.instances.length, 2);
    const [backdrop, glyph] = withBackdrop.instances;
    assert.equal(backdrop.u0, 0, '底板用整张纹理');
    assert.equal(backdrop.u1, 1);
    assert.equal(backdrop.colorA, 0.5, '底板半透明');
    assert.equal(backdrop.sx > glyph.sx, true, '底板比文字宽');
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
