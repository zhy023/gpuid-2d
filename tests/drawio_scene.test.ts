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
import {
  isDrawioCellData,
  normalizeIconUrl,
  parseDrawioColor,
  toPidScene,
} from '@/business/pid_schematic/drawio/to_pid_scene';

const XML_PATH = path.join(process.cwd(), 'public/assets/graph/meta_demo.xml');

describe('toPidScene（真实图纸）', () => {
  const document = parseMxDocument(
    readFileSync(XML_PATH, 'utf8'),
    new DOMParser() as unknown as DOMParser,
  );
  const result = toPidScene(document);

  it('把图纸翻译成设备矩形 / 管线 / 位号', () => {
    console.log(
      `[drawio] 设备 ${result.stats.devices} / 管线 ${result.stats.pipes} / 位号 ${result.stats.labels} / 图标 ${result.stats.icons} / 跳过 ${result.stats.skipped}（共 ${document.nodes.length} 个单元）`,
    );
    assert.ok(result.stats.devices > 0, '应当解析出设备图元');
    assert.ok(result.stats.pipes > 0, '应当解析出管线');
    assert.ok(result.labels.length > 0, '应当解析出位号文字');
    assert.ok(result.stats.icons > 0, '应当提取出内联图标');
  });

  it('图纸管线默认静止（默认样式）', () => {
    for (const pipe of result.scene.pipes.values()) {
      assert.equal(pipe.flowSpeed, 0, `管线 ${pipe.id} 应为静止样式`);
    }
  });

  it('图元带着原始单元信息（data 纯属性，不参与绘制）', () => {
    const device = [...result.scene.devices.values()][0];
    assert.ok(device, '应当有设备图元');
    assert.ok(isDrawioCellData(device.data), '设备上应挂着图纸单元信息');
    const cellData = device.data;
    assert.equal(cellData.kind, 'device');
    assert.ok(cellData.cellId.length > 0, '保留 drawio 的字符串 id');
    assert.equal(typeof cellData.style, 'object');

    const pipe = [...result.scene.pipes.values()][0];
    assert.ok(pipe && isDrawioCellData(pipe.data), '管线上应挂着图纸单元信息');
    assert.equal(pipe.data.kind, 'pipe');

    // 纯属性：不影响打包出来的实例，也不触发重绘
    pipe.clearDirty();
    const before = pipe.toInstance();
    pipe.setData({ ...pipe.data, label: '改名了' });
    assert.equal(pipe.dirty, false, '换数据不该置 dirty');
    assert.deepEqual(pipe.toInstance(), before, '数据不进实例');
  });

  it('图标 key 都是合法图元 id，且是 data URL', () => {
    for (const [id, url] of result.icons) {
      assert.ok(result.scene.devices.get(id) !== undefined, `图标 ${id} 应当对应一个设备图元`);
      assert.ok(url.startsWith('data:image'), '图标应当是 data URL');
      // drawio 写的是 data:image/png,<base64>（少了 ;base64），不补回去浏览器解码必然失败
      assert.ok(url.includes(';base64,'), `图标 ${id} 应当是可解码的 base64 data URL`);
    }
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

  it('图纸范围覆盖全部图元（相机取景用它，不能写死页宽高）', () => {
    const { bounds } = result;
    assert.ok(bounds.maxX > bounds.minX && bounds.maxY > bounds.minY);
    for (const device of result.scene.devices.values()) {
      assert.ok(device.worldAABB.minX >= bounds.minX && device.worldAABB.maxX <= bounds.maxX);
      assert.ok(device.worldAABB.minY >= bounds.minY && device.worldAABB.maxY <= bounds.maxY);
    }
  });
});

describe('normalizeIconUrl', () => {
  it('drawio 的 data:image/png,<base64> 补上 ;base64', () => {
    assert.equal(
      normalizeIconUrl('data:image/png,iVBORw0KGgoAAAANSUhEUg=='),
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==',
    );
  });

  it('已经是 ;base64 的不动', () => {
    const url = 'data:image/png;base64,iVBORw0KGgo=';
    assert.equal(normalizeIconUrl(url), url);
  });

  it('百分号编码的（如内联 SVG）不动', () => {
    const url = 'data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org';
    assert.equal(normalizeIconUrl(url), url);
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
