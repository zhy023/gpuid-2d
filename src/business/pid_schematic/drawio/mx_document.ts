/**
 * draw.io XML（mxGraphModel）读取器。
 *
 * 零运行时依赖：`DOMParser` 由调用方注入（浏览器用内置实现，Node 测试注入 @xmldom/xmldom）。
 * 输出「规范化节点」：绝对坐标、样式对象、文字、端点与折点；几何语义（哪类图元）留给上层翻译。
 */
import type { MxStyle } from '@/business/pid_schematic/drawio/mx_style';
import { parseMxStyle } from '@/business/pid_schematic/drawio/mx_style';

export interface MxPoint {
  x: number;
  y: number;
}

export interface MxNode {
  id: string;
  parentId: string | null;
  /** true = 连线（edge=1），几何按端点/折点解释 */
  isEdge: boolean;
  /** 绝对坐标（父子层级累加后的左上角） */
  x: number;
  y: number;
  width: number;
  height: number;
  style: MxStyle;
  /** 显示文字（mxCell 的 value，已做实体解码） */
  value: string;
  sourceId?: string;
  targetId?: string;
  /** 边的折点（绝对坐标） */
  points: MxPoint[];
  /** 边几何是否为 relative=1（端点由 source/target 决定） */
  relative: boolean;
}

export interface MxDocument {
  nodes: MxNode[];
  byId: Map<string, MxNode>;
}

/** 常见 XML 实体（DOMParser 已处理大部分，这里兜住 &nbsp; 之类） */
function decodeEntities(text: string): string {
  const entities: Record<string, string> = {
    amp: '&',
    lt: '<',
    gt: '>',
    quot: '"',
    apos: "'",
    nbsp: ' ',
  };
  return text.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (whole, body: string) => {
    if (body.startsWith('#')) {
      const code =
        body[1] === 'x' || body[1] === 'X'
          ? Number.parseInt(body.slice(2), 16)
          : Number.parseInt(body.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
    }
    return entities[body] ?? whole;
  });
}

function attr(element: Element, name: string): string | null {
  return element.getAttribute(name);
}

/** 读取一个 mxCell 的几何（含边的 source/target 端点与折点） */
function readGeometry(cell: Element): {
  x: number;
  y: number;
  width: number;
  height: number;
  relative: boolean;
  points: MxPoint[];
  sourcePoint?: MxPoint;
  targetPoint?: MxPoint;
} {
  const geometry = cell.getElementsByTagName('mxGeometry')[0];
  const result: {
    x: number;
    y: number;
    width: number;
    height: number;
    relative: boolean;
    points: MxPoint[];
    sourcePoint?: MxPoint;
    targetPoint?: MxPoint;
  } = {
    x: 0,
    y: 0,
    width: 0,
    height: 0,
    relative: false,
    points: [] as MxPoint[],
    sourcePoint: undefined,
    targetPoint: undefined,
  };
  if (!geometry) return result;

  result.x = Number(attr(geometry, 'x') ?? 0);
  result.y = Number(attr(geometry, 'y') ?? 0);
  result.width = Number(attr(geometry, 'width') ?? 0);
  result.height = Number(attr(geometry, 'height') ?? 0);
  result.relative = attr(geometry, 'relative') === '1';

  // 折点写在 <Array as="points"><mxPoint .../></Array> 里，要按后代找而不是只看直接子节点
  for (const element of Array.from(geometry.getElementsByTagName('mxPoint'))) {
    const as = attr(element, 'as');
    if (as === 'sourcePoint' || as === 'targetPoint') continue;
    const point = { x: Number(attr(element, 'x') ?? 0), y: Number(attr(element, 'y') ?? 0) };
    result.points.push(point);
  }
  return result;
}

/**
 * 解析 mxGraphModel
 * @param xmlText XML 文本
 * @param domParser 注入的 DOMParser（浏览器内置 / Node 用 @xmldom/xmldom）
 */
export function parseMxDocument(xmlText: string, domParser: DOMParser): MxDocument {
  const document = domParser.parseFromString(xmlText, 'text/xml');
  const cells = Array.from(document.getElementsByTagName('mxCell'));
  const nodes: MxNode[] = [];
  const byId = new Map<string, MxNode>();

  for (const cell of cells) {
    // id 通常在自己身上；被 <UserObject> 包住时 id/label 在外层
    const wrapper =
      cell.parentNode && (cell.parentNode as Element).tagName === 'UserObject'
        ? (cell.parentNode as Element)
        : null;
    const id = attr(cell, 'id') ?? (wrapper ? attr(wrapper, 'id') : null);
    if (!id) continue;

    const geometry = readGeometry(cell);
    const node: MxNode = {
      id,
      parentId: attr(cell, 'parent'),
      isEdge: attr(cell, 'edge') === '1',
      x: geometry.x,
      y: geometry.y,
      width: geometry.width,
      height: geometry.height,
      style: parseMxStyle(attr(cell, 'style') ?? (wrapper ? attr(wrapper, 'style') : null)),
      value: decodeEntities(attr(cell, 'value') ?? (wrapper ? attr(wrapper, 'label') : '') ?? ''),
      sourceId: attr(cell, 'source') ?? undefined,
      targetId: attr(cell, 'target') ?? undefined,
      points: geometry.points,
      relative: geometry.relative,
    };
    nodes.push(node);
    byId.set(node.id, node);
  }

  // 绝对坐标：mxCell 的 x/y 相对父容器，逐层累加（成组阀门＝组 + 子格）
  const absoluteCache = new Map<string, MxPoint>();
  function absoluteOrigin(node: MxNode): MxPoint {
    const cached = absoluteCache.get(node.id);
    if (cached) return cached;
    const parent = node.parentId ? byId.get(node.parentId) : undefined;
    const origin = parent
      ? { x: absoluteOrigin(parent).x + node.x, y: absoluteOrigin(parent).y + node.y }
      : { x: node.x, y: node.y };
    absoluteCache.set(node.id, origin);
    return origin;
  }

  for (const node of nodes) {
    const origin = absoluteOrigin(node);
    const parentOffsetX = origin.x - node.x;
    const parentOffsetY = origin.y - node.y;
    node.x = origin.x;
    node.y = origin.y;
    node.points = node.points.map((point) => ({
      x: point.x + parentOffsetX,
      y: point.y + parentOffsetY,
    }));
  }

  return { nodes, byId };
}
