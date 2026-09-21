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
import { applyValveFlowState } from '@/business/pid_schematic/topology';

const XML_PATH = path.join(process.cwd(), 'public/assets/graph/meta_demo.xml');
const VALVE_OFF_PATH = path.join(process.cwd(), 'public/assets/famen_off@2x.png');
const VALVE_ON_PATH = path.join(process.cwd(), 'public/assets/famen_on@2x.png');

/** 本地贴图 → data URL：图纸里内联的阀门图标就是同一份字节，用它当「这是阀门」的判据 */
function toDataUrl(filePath: string): string {
  return `data:image/png,${readFileSync(filePath).toString('base64')}`;
}

const VALVE_ICONS = [{ url: toDataUrl(VALVE_OFF_PATH) }, { url: toDataUrl(VALVE_ON_PATH) }];

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

  it('纯连接点（shape=waypoint）不建成图元，只保留 id 给管线串联', () => {
    const withValves = toPidScene(document, { valveIcons: VALVE_ICONS });
    assert.ok(withValves.stats.connectionPoints > 0, '样例图纸里有连接点');
    assert.equal(
      withValves.stats.devices,
      result.stats.devices - withValves.stats.valves,
      '设备数 = 原设备数 - 被识别成阀门的单元（连接点在两边都不算设备）',
    );
    // 连接点虽然没有图元，但拓扑仍要能串过去
    assert.equal(
      [...withValves.topology.values()].length,
      withValves.stats.pipes,
      '每条管线仍然建了拓扑链',
    );
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
    assert.ok(pipe, '应当有管线');
    const pipeData = pipe.data;
    assert.ok(isDrawioCellData(pipeData), '管线上应挂着图纸单元信息');
    assert.equal(pipeData.kind, 'pipe');

    // 纯属性：不影响打包出来的实例，也不触发重绘
    pipe.clearDirty();
    const before = pipe.toInstance();
    pipe.setData({ ...pipeData, label: '改名了' });
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

  it('阀门单元翻成 ValveGraphic（selectable 能力），其余仍是普通设备', () => {
    const withValves = toPidScene(document, { valveIcons: VALVE_ICONS });
    const valves = [...withValves.scene.valves.values()];

    assert.equal(withValves.stats.valves, 40, '样例图纸有 40 个阀门单元（39 关 + 1 开）');
    assert.equal(valves.length, 40);
    assert.equal(
      valves.filter((valve) => valve.open).length,
      0,
      '阀门默认关闭（图纸是静止的初始态）',
    );
    // 阀门从设备里摘出来了：设备数 = 原来的设备数 - 阀门数
    assert.equal(
      withValves.stats.devices,
      result.stats.devices - withValves.stats.valves,
      '阀门不再算普通设备',
    );
    // 阀门自带开/关状态与可选中能力（selectable 层）
    const valve = valves[0];
    assert.equal(typeof valve.setSelected, 'function', '阀门可选中');
    assert.equal(typeof valve.setOpen, 'function', '阀门有自己的开/关状态');
    assert.ok(isDrawioCellData(valve.data) && valve.data.kind === 'valve');

    // 需要初始打开时由调用方显式声明
    const opened = toPidScene(document, { valveIcons: VALVE_ICONS, valveOpen: true });
    assert.equal(
      [...opened.scene.valves.values()].every((valve) => valve.open),
      true,
      'valveOpen: true 时阀门初始为开',
    );
  });

  it('管线按边的 source → target 挂到阀门上（拓扑管方向）', () => {
    const withValves = toPidScene(document, { valveIcons: VALVE_ICONS });
    const links = [...withValves.topology.values()];

    assert.equal(links.length, withValves.stats.pipes, '每条管线都建了拓扑链');
    // 样例图纸的边两端指向阀门组里的关节单元：应当解析到阀门上
    const valveIds = new Set([...withValves.scene.valves.values()].map((valve) => valve.id));
    const touched = links.filter(
      (link) => valveIds.has(link.sourceElementId) || valveIds.has(link.targetElementId),
    );
    assert.ok(touched.length > 0, '至少有管线挂在阀门上');

    // 关掉一个阀门：从它发出的管线（source → target 方向）应当切回默认样式
    const valve = [...withValves.scene.valves.values()].find((candidate) =>
      links.some((link) => link.sourceElementId === candidate.id),
    );
    assert.ok(valve, '应当能找到有下游管线的阀门');
    valve.setOpen(false);
    applyValveFlowState(
      withValves.topology,
      withValves.scene.valves.values(),
      withValves.scene.pipes,
    );
    for (const link of links.filter((item) => item.sourceElementId === valve.id)) {
      const pipe = withValves.scene.pipes.get(link.pipelineId);
      assert.ok(pipe, `管线 ${link.pipelineId} 应当存在`);
      assert.equal(pipe.flowSpeed, 0, '阀门关闭后下游管线是默认样式');
    }
  });

  it('接在连接点上的管线共用同一个端点（中心出线，接头不断开）', () => {
    const withValves = toPidScene(document, { valveIcons: VALVE_ICONS });
    const endpoints = new Map<string, Array<{ x: number; y: number }>>();

    for (const pipe of withValves.scene.pipes.values()) {
      if (!isDrawioCellData(pipe.data)) continue;
      const cells = [
        { cellId: pipe.data.sourceId, point: pipe.points[0] },
        { cellId: pipe.data.targetId, point: pipe.points[pipe.points.length - 1] },
      ];
      for (const cell of cells) {
        if (!cell.cellId || !cell.point) continue;
        const node = document.byId.get(cell.cellId);
        if (node?.style.shape !== 'waypoint') continue;
        // 连接点用 centerPerimeter：端口就是单元中心，必须严格对上
        assert.equal(Number(cell.point.x.toFixed(6)), Number((node.x + node.width / 2).toFixed(6)));
        assert.equal(
          Number(cell.point.y.toFixed(6)),
          Number((node.y + node.height / 2).toFixed(6)),
        );
        const bucket = endpoints.get(cell.cellId) ?? [];
        bucket.push(cell.point);
        endpoints.set(cell.cellId, bucket);
      }
    }

    assert.ok(endpoints.size > 0, '样例图纸里有接在连接点上的管线');
    for (const [cellId, points] of endpoints) {
      for (const point of points) {
        assert.deepEqual(point, points[0], `连接点 ${cellId} 上的端点应当完全重合`);
      }
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
