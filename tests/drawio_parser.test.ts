/**
 * draw.io 解析用例：注入 @xmldom/xmldom 的 DOMParser（浏览器里用内置实现），
 * 验证样式拆分、节点/边解析、绝对坐标累加与端点可解析。
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { DOMParser } from '@xmldom/xmldom';
import { parseMxDocument } from '@/business/pid_schematic/drawio/mx_document';
import { mxFlag, mxNumber, parseMxStyle } from '@/business/pid_schematic/drawio/mx_style';

const XML_PATH = path.join(process.cwd(), 'public/assets/graph/meta_demo.xml');

describe('parseMxStyle', () => {
  it('拆分键值与非键值标记，并提供数值/布尔取值', () => {
    const style = parseMxStyle('rounded=0;ellipse;strokeWidth=2;text');
    assert.equal(style.rounded, '0');
    assert.equal(style.ellipse, '1');
    assert.equal(style.text, '1');
    assert.equal(mxNumber(style, 'strokeWidth', 1), 2);
    assert.equal(mxNumber(style, 'missing', 5), 5);
    assert.equal(mxFlag(style, 'ellipse'), true);
    assert.equal(mxFlag(style, 'rounded'), false);
  });
});

describe('parseMxDocument（真实图纸 meta_demo.xml）', () => {
  const xml = readFileSync(XML_PATH, 'utf8');
  const document = parseMxDocument(xml, new DOMParser() as unknown as DOMParser);

  it('解析出全部 mxCell，且 id 到节点一一对应', () => {
    assert.ok(document.nodes.length > 500, `节点数偏少：${document.nodes.length}`);
    assert.equal(document.byId.size, document.nodes.length);
  });

  it('每条边都能在节点表里找到两端', () => {
    const edges = document.nodes.filter((node) => node.isEdge);
    assert.ok(edges.length > 0, '图纸里应当有连线');

    const dangling = edges.filter(
      (node) =>
        (node.sourceId !== undefined && !document.byId.has(node.sourceId)) ||
        (node.targetId !== undefined && !document.byId.has(node.targetId)),
    );
    assert.equal(
      dangling.length,
      0,
      `有边指向不存在的节点：${dangling.map((n) => n.id).join(', ')}`,
    );
  });

  it('坐标已按父链累加为绝对值', () => {
    // 所有坐标都应是有限值
    for (const node of document.nodes) {
      assert.ok(Number.isFinite(node.x) && Number.isFinite(node.y), `节点 ${node.id} 坐标非法`);
    }

    // 至少有若干「子格」的绝对坐标与其父不同 —— 说明确实做了累加而不是照抄相对值
    const accumulated = document.nodes.filter((node) => {
      const parent = node.parentId ? document.byId.get(node.parentId) : undefined;
      return (
        parent !== undefined &&
        (parent.width > 0 || parent.height > 0) &&
        (node.x !== parent.x || node.y !== parent.y)
      );
    });
    assert.ok(accumulated.length > 0, '应当存在坐标被累加过的子格（成组图元）');
  });

  it('边折点已折算成绝对坐标', () => {
    const edgesWithPoints = document.nodes.filter((node) => node.isEdge && node.points.length > 0);
    assert.ok(edgesWithPoints.length > 0, '图纸里应当有带折点的连线');
    for (const edge of edgesWithPoints) {
      for (const point of edge.points) {
        assert.ok(Number.isFinite(point.x) && Number.isFinite(point.y));
      }
    }
  });
});
