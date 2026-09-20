/**
 * 规范化 draw.io 节点 → PidScene（图纸语义翻译层）。
 *
 * 规则：
 *   - `edge=1`：管线折线，端点取 source/target 节点中心，折点用 XML 里的 <Array as="points">
 *   - 有几何的普通单元：设备矩形（中心 + 尺寸）
 *   - 带文字的单元：位号（文字 + 位置 + 颜色），由绘制端排版
 * mxCell 的 id 是字符串，这里统一分配数字 id（四叉树按数字索引）。
 */
import type { MxDocument, MxNode } from '@/business/pid_schematic/drawio/mx_document';
import { mxNumber } from '@/business/pid_schematic/drawio/mx_style';
import { PidScene } from '@/business/pid_schematic/pid_scene';
import { createPipeItem } from '@/business/pid_schematic/pipe_line';
import { snapPipeLineWidthPx } from '@/business/pid_schematic/pipe_style';
import type { StressTestItem } from '@/business/pid_schematic/device_stress_test';
import type { AABB } from '@/core/types';

/** 位号：文字 + 世界坐标 + 颜色（rgba） */
export interface PidLabel {
  text: string;
  x: number;
  y: number;
  color: readonly [number, number, number, number];
  fontSizePx: number;
}

export interface DrawioSceneResult {
  scene: PidScene;
  labels: PidLabel[];
  /** 统计：便于和 XML 里的单元数对账 */
  stats: { devices: number; pipes: number; labels: number; skipped: number };
}

const DEFAULT_COLOR: readonly [number, number, number, number] = [0.12, 0.12, 0.14, 1];

/** drawio 颜色：`#RRGGBB` / `none` / `light-dark(a,b)`（取第一个）→ rgba 元组 */
export function parseDrawioColor(
  raw: string | undefined,
): readonly [number, number, number, number] | null {
  if (!raw || raw === 'none') return null;
  const value = raw.startsWith('light-dark(')
    ? raw.slice('light-dark('.length).split(',')[0].trim()
    : raw;
  const hex = value.replace('#', '');
  if (hex.length !== 6 && hex.length !== 3) return null;
  const full =
    hex.length === 3
      ? hex
          .split('')
          .map((c) => c + c)
          .join('')
      : hex;
  const int = Number.parseInt(full, 16);
  if (!Number.isFinite(int)) return null;
  return [((int >> 16) & 0xff) / 255, ((int >> 8) & 0xff) / 255, (int & 0xff) / 255, 1];
}

/** 计算图纸世界范围（含边折点），四叉树根节点用它 */
function computeBounds(nodes: readonly MxNode[]): AABB {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  const grow = (x: number, y: number) => {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  };

  for (const node of nodes) {
    if (node.isEdge) {
      for (const point of node.points) grow(point.x, point.y);
      continue;
    }
    if (node.width <= 0 && node.height <= 0) continue;
    grow(node.x, node.y);
    grow(node.x + node.width, node.y + node.height);
  }

  if (!Number.isFinite(minX)) return { minX: 0, minY: 0, maxX: 1, maxY: 1 };
  const margin = Math.max(maxX - minX, maxY - minY) * 0.02 + 1;
  return { minX: minX - margin, minY: minY - margin, maxX: maxX + margin, maxY: maxY + margin };
}

export function toPidScene(document: MxDocument): DrawioSceneResult {
  const scene = new PidScene(computeBounds(document.nodes));
  const labels: PidLabel[] = [];
  const numericIds = new Map<string, number>();
  const stats = { devices: 0, pipes: 0, labels: 0, skipped: 0 };
  let nextId = 1;

  const idOf = (rawId: string): number => {
    const existing = numericIds.get(rawId);
    if (existing !== undefined) return existing;
    const id = nextId++;
    numericIds.set(rawId, id);
    return id;
  };

  const centerOf = (node: MxNode) => ({ x: node.x + node.width / 2, y: node.y + node.height / 2 });

  // 先建图元（边要查两端节点的中心）
  for (const node of document.nodes) {
    // 跳过 drawio 的图层与根节点
    if (node.id === '0' || node.id === '1') continue;

    if (node.isEdge) {
      const source = node.sourceId ? document.byId.get(node.sourceId) : undefined;
      const target = node.targetId ? document.byId.get(node.targetId) : undefined;
      if (!source || !target) {
        stats.skipped += 1;
        continue;
      }
      const points = [centerOf(source), ...node.points, centerOf(target)];
      if (points.length < 2) {
        stats.skipped += 1;
        continue;
      }
      const lineWidthPx = snapPipeLineWidthPx(mxNumber(node.style, 'strokeWidth', 2));
      scene.upsertPipe(createPipeItem(idOf(node.id), points, lineWidthPx));
      stats.pipes += 1;
      continue;
    }

    if (node.width <= 0 || node.height <= 0) {
      stats.skipped += 1;
      continue;
    }

    const center = centerOf(node);
    const device: StressTestItem = {
      id: idOf(node.id),
      dirty: false,
      tx: center.x,
      ty: center.y,
      sx: node.width,
      sy: node.height,
      beta: 0,
      selected: 0,
      worldAABB: {
        minX: node.x,
        minY: node.y,
        maxX: node.x + node.width,
        maxY: node.y + node.height,
      },
    };
    scene.upsertDevice(device);
    stats.devices += 1;

    // 文字：value 非空即视为位号（绘制端再决定字号与是否显示）
    const text = node.value.trim();
    if (text) {
      const color = parseDrawioColor(node.style.fontColor) ?? DEFAULT_COLOR;
      const fontSizePx = Math.max(10, Math.round(mxNumber(node.style, 'fontSize', 12)));
      labels.push({ text, x: node.x, y: center.y, color, fontSizePx });
      stats.labels += 1;
    }
  }

  return { scene, labels, stats };
}
