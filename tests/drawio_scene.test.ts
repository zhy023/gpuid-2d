/**
 * 图纸 → PidScene 的翻译用例（真实 meta_demo.xml）：
 * 统计设备/管线/位号数量，并验证图元都落在世界范围内可被视口查询命中。
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { DOMParser } from '@xmldom/xmldom';
import { parseMxDocument } from '@/business/pid_schematic/drawio/mx_document';
import { parseDrawioColor, toPidScene } from '@/business/pid_schematic/drawio/to_pid_scene';

const XML_PATH = path.join(process.cwd(), 'public/assets/graph/meta_demo.xml');

describe('toPidScene（真实图纸）', () => {
  const document = parseMxDocument(
    readFileSync(XML_PATH, 'utf8'),
    new DOMParser() as unknown as DOMParser,
  );
  const result = toPidScene(document);

  it('把图纸翻译成设备矩形 / 管线 / 位号', () => {
    console.log(
      `[drawio] 设备 ${result.stats.devices} / 管线 ${result.stats.pipes} / 位号 ${result.stats.labels} / 跳过 ${result.stats.skipped}（共 ${document.nodes.length} 个单元）`,
    );
    assert.ok(result.stats.devices > 0, '应当解析出设备图元');
    assert.ok(result.stats.pipes > 0, '应当解析出管线');
    assert.ok(result.labels.length > 0, '应当解析出位号文字');
  });

  it('图元都落在世界范围内，超大视口查询应全部命中', () => {
    const all = result.scene.getVisible({
      minX: -1e6,
      minY: -1e6,
      maxX: 1e6,
      maxY: 1e6,
    });
    assert.equal(all.devices.length, result.stats.devices);
    assert.equal(all.pipes.length, result.stats.pipes);
  });

  it('位号带颜色与字号，坐标有限', () => {
    for (const label of result.labels) {
      assert.ok(Number.isFinite(label.x) && Number.isFinite(label.y));
      assert.ok(label.fontSizePx > 0);
      assert.equal(label.color.length, 4);
    }
  });
});

describe('parseDrawioColor', () => {
  it('解析 #RRGGBB / #RGB / light-dark(...) / none', () => {
    assert.deepEqual(parseDrawioColor('#ff0000'), [1, 0, 0, 1]);
    assert.deepEqual(parseDrawioColor('#0f0'), [0, 1, 0, 1]);
    const [r, g, b, a] = parseDrawioColor('light-dark(#123456,#ffffff)') ?? [];
    assert.equal(Math.round(r * 255), 0x12);
    assert.equal(Math.round(g * 255), 0x34);
    assert.equal(Math.round(b * 255), 0x56);
    assert.equal(a, 1);
    assert.equal(parseDrawioColor('none'), null);
    assert.equal(parseDrawioColor(undefined), null);
  });
});
