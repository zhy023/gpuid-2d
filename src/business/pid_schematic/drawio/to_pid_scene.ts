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
import { mxFlag, mxNumber, type MxStyle } from '@/business/pid_schematic/drawio/mx_style';
import { createFlowPipe } from '@/business/pid_schematic/flow_pipe';
import { PidScene } from '@/business/pid_schematic/pid_scene';
import { snapPipeLineWidthPx } from '@/business/pid_schematic/pipe_style';
import { SelectableGraphic } from '@/core/scene/capability/selectable';
import type { AABB } from '@/core/types';

/** 位号：文字 + 世界坐标 + 颜色（rgba） */
export interface PidLabel {
  text: string;
  x: number;
  y: number;
  color: readonly [number, number, number, number];
  fontSizePx: number;
}

/**
 * 挂在图元 `Graphic#data` 上的图纸来源信息（纯业务数据，内核不解释、不参与绘制）。
 *
 * 图纸里一个 mxCell 翻译成一个图元后，原始 id / 文字 / 样式 / 端点都跟着图元走，
 * 这样「选中图元 → 查看信息」不必再回头查 XML。
 */
export interface DrawioCellData {
  /** mxCell 的原始 id（drawio 的字符串 id，和内核的数字 id 不是一回事） */
  cellId: string;
  /** 单元显示文字（位号/名称），可能为空串 */
  label: string;
  /** 这个单元被翻成了哪类图元 */
  kind: 'device' | 'pipe';
  /** drawio 原始样式键值（fillColor / strokeColor / fontSize / image …） */
  style: MxStyle;
  /** 连线的两端单元 id（设备没有） */
  sourceId?: string;
  targetId?: string;
}

/** 判断挂在图元上的自定义数据是不是图纸来源信息（跨场景取数据时用） */
export function isDrawioCellData(value: unknown): value is DrawioCellData {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Partial<DrawioCellData>;
  return typeof candidate.cellId === 'string' && typeof candidate.kind === 'string';
}

export interface DrawioSceneResult {
  scene: PidScene;
  labels: PidLabel[];
  /** 图元数字 id → 内联图标 data URL（drawio 把图标放在 style.image 里） */
  icons: Map<number, string>;
  /** 图纸世界范围（调用方用它给相机取景，不要去猜页宽高） */
  bounds: AABB;
  /** 统计：便于和 XML 里的单元数对账 */
  stats: { devices: number; pipes: number; labels: number; icons: number; skipped: number };
}

const DEFAULT_COLOR: readonly [number, number, number, number] = [0.12, 0.12, 0.14, 1];

/**
 * drawio 存内联图片时写的是 `data:image/png,<base64>`（少了 `;base64`），
 * 浏览器会把它当百分号编码的文本来解，`createImageBitmap` 必然报
 * 「The source image could not be decoded」。这里按 drawio 的约定补回 `;base64`。
 */
export function normalizeIconUrl(url: string): string {
  if (url.includes(';base64')) return url;
  const match = /^data:image\/[a-z0-9.+-]+,(.*)$/is.exec(url);
  if (!match) return url;
  const payload = match[1];
  // 带 `%` 的是真的百分号编码（如内联 SVG），不能当 base64 处理
  if (payload.includes('%')) return url;
  if (!/^[A-Za-z0-9+/=\s]+$/.test(payload)) return url;
  return url.replace(',', ';base64,');
}

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
  // 图纸坐标原点不一定在左上角（这份样例的 y 全是负的），范围要算出来给相机用
  const bounds = computeBounds(document.nodes);
  const scene = new PidScene(bounds);
  const labels: PidLabel[] = [];
  const icons = new Map<number, string>();
  const numericIds = new Map<string, number>();
  const stats = { devices: 0, pipes: 0, labels: 0, icons: 0, skipped: 0 };
  let nextId = 1;

  const idOf = (rawId: string): number => {
    const existing = numericIds.get(rawId);
    if (existing !== undefined) return existing;
    const id = nextId++;
    numericIds.set(rawId, id);
    return id;
  };

  const centerOf = (node: MxNode) => ({ x: node.x + node.width / 2, y: node.y + node.height / 2 });

  /** 端点在节点矩形上的锚点：fx/fy 是 0~1 的比例（drawio 的 exitX/entryX） */
  const anchorOf = (node: MxNode, fx: number, fy: number) => ({
    x: node.x + node.width * fx,
    y: node.y + node.height * fy,
  });

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
      // 走线按 drawio 的出口/入口锚点：缺省 0.5 = 中心；orthogonal 的折点来自 <Array as="points">
      const exit = anchorOf(
        source,
        mxNumber(node.style, 'exitX', 0.5),
        mxNumber(node.style, 'exitY', 0.5),
      );
      const entry = anchorOf(
        target,
        mxNumber(node.style, 'entryX', 0.5),
        mxNumber(node.style, 'entryY', 0.5),
      );
      const points = [exit, ...node.points, entry];
      if (points.length < 2) {
        stats.skipped += 1;
        continue;
      }
      const lineWidthPx = snapPipeLineWidthPx(mxNumber(node.style, 'strokeWidth', 2));
      const pipe = createFlowPipe(idOf(node.id), points, lineWidthPx);
      // 图纸管线默认关闭（正式图纸不需要流动条纹），需要动画时由上层再打开
      pipe.setOpen(false);
      // 图纸里 dashed=1 的管线画成静态虚线
      pipe.setDashed(mxFlag(node.style, 'dashed'));
      // 图纸的 strokeColor → 管身底色（拿不到就沿用管线着色器的默认配色）
      pipe.fill(parseDrawioColor(node.style.strokeColor));
      // 原始单元信息跟着图元走（纯属性，不参与绘制）
      pipe.setData({
        cellId: node.id,
        label: node.value.trim(),
        kind: 'pipe',
        style: node.style,
        ...(node.sourceId ? { sourceId: node.sourceId } : {}),
        ...(node.targetId ? { targetId: node.targetId } : {}),
      } satisfies DrawioCellData);
      scene.upsertPipe(pipe);
      stats.pipes += 1;
      continue;
    }

    if (node.width <= 0 || node.height <= 0) {
      stats.skipped += 1;
      continue;
    }

    const center = centerOf(node);
    // drawio 的 rotation 是角度；fillColor 是填充色（fill=none 或没写就是不绘制）
    const beta = (mxNumber(node.style, 'rotation', 0) * Math.PI) / 180;
    // flipH/flipV 用负缩放表达（贴图跟着镜像，和 drawio 一致）
    const sx = mxFlag(node.style, 'flipH') ? -node.width : node.width;
    const sy = mxFlag(node.style, 'flipV') ? -node.height : node.height;
    const device = new SelectableGraphic({
      id: idOf(node.id),
      x: center.x,
      y: center.y,
      width: sx,
      height: sy,
      rotation: beta,
      fillColor: parseDrawioColor(node.style.fillColor),
      // 原始单元信息跟着图元走（纯属性，不参与绘制）
      data: {
        cellId: node.id,
        label: node.value.trim(),
        kind: 'device',
        style: node.style,
      } satisfies DrawioCellData,
    });
    device.clearDirty();
    scene.upsertDevice(device);
    stats.devices += 1;

    // 图标：drawio 的图片单元把 base64 放在 style.image 里，绘制端按它贴图
    const iconUrl = node.style.image;
    if (iconUrl?.startsWith('data:image')) {
      icons.set(device.id, normalizeIconUrl(iconUrl));
      stats.icons += 1;
    }

    // 文字：value 非空即视为位号（绘制端再决定字号与是否显示）
    const text = node.value.trim();
    if (text) {
      const color = parseDrawioColor(node.style.fontColor) ?? DEFAULT_COLOR;
      const fontSizePx = Math.max(10, Math.round(mxNumber(node.style, 'fontSize', 12)));
      // 存图元中心（drawio 默认把文字居中在图元里），绘制端据此居中排版
      labels.push({ text, x: center.x, y: center.y, color, fontSizePx });
      stats.labels += 1;
    }
  }

  return { scene, labels, icons, bounds, stats };
}
