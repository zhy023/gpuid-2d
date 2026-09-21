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
import { Topology } from '@/business/pid_schematic/topology';
import { ValveGraphic } from '@/business/pid_schematic/valve_graphic';
import { orthogonalizePolyline, type Point } from '@/core/geometry/polyline';
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
  kind: 'device' | 'valve' | 'pipe';
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
  /** 管线 → 两端设备的拓扑（按边的 source → target 方向建，供阀门开关向下游广播） */
  topology: Topology;
  labels: PidLabel[];
  /** 图元数字 id → 内联图标 data URL（drawio 把图标放在 style.image 里） */
  icons: Map<number, string>;
  /** 图纸世界范围（调用方用它给相机取景，不要去猜页宽高） */
  bounds: AABB;
  /** 统计：便于和 XML 里的单元数对账 */
  stats: {
    devices: number;
    valves: number;
    /** 纯连接点（drawio 的 `shape=waypoint`）：只用来接边，不建图元 */
    connectionPoints: number;
    pipes: number;
    labels: number;
    icons: number;
    skipped: number;
  };
}

/**
 * 阀门图标：图纸用内联图片表示阀门时，调用方把「哪张图是阀门」告诉翻译层。
 * 比较时忽略 base64 里的空白，所以调用方给本地贴图文件编码出来的 data URL 即可。
 */
export interface DrawioValveIcon {
  /** 内联图片 data URL（`data:image/png,...`） */
  url: string;
}

export interface ToPidSceneOptions {
  /** 识别为阀门的内联图标；不传则所有非连线单元都按普通设备处理 */
  valveIcons?: readonly DrawioValveIcon[];
  /** 阀门初始开关状态，默认 false（图纸里的阀门默认关闭） */
  valveOpen?: boolean;
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

export function toPidScene(
  document: MxDocument,
  options: ToPidSceneOptions = {},
): DrawioSceneResult {
  // 图纸坐标原点不一定在左上角（这份样例的 y 全是负的），范围要算出来给相机用
  const bounds = computeBounds(document.nodes);
  const scene = new PidScene(bounds);
  const topology = new Topology();
  const labels: PidLabel[] = [];
  const icons = new Map<number, string>();
  const numericIds = new Map<string, number>();
  // 图纸把一个阀门画成「关节单元 + 位号 + 阀门图标」一组：边的两端指向组里的关节单元，
  // 所以要把「单元 → 所属组 → 组里的阀门」串起来，管线才能挂到阀门上
  const cellGroupId = new Map<string, string>();
  const groupValveId = new Map<string, number>();
  const pendingLinks: Array<{ pipeId: number; sourceId: string; targetId: string }> = [];
  const stats = {
    devices: 0,
    valves: 0,
    connectionPoints: 0,
    pipes: 0,
    labels: 0,
    icons: 0,
    skipped: 0,
  };
  let nextId = 1;

  const idOf = (rawId: string): number => {
    const existing = numericIds.get(rawId);
    if (existing !== undefined) return existing;
    const id = nextId++;
    numericIds.set(rawId, id);
    return id;
  };

  const centerOf = (node: MxNode) => ({ x: node.x + node.width / 2, y: node.y + node.height / 2 });

  /** 内联图标是否命中「阀门图标」表：两边都按同一套规则规范化（补 `;base64`、去掉空白） */
  const matchValveIcon = (iconUrl: string): DrawioValveIcon | null => {
    if (!options.valveIcons?.length) return null;
    const normalize = (url: string) => normalizeIconUrl(url).replace(/\s+/g, '');
    const normalized = normalize(iconUrl);
    for (const icon of options.valveIcons) {
      if (normalize(icon.url) === normalized) return icon;
    }
    return null;
  };

  /** 端点在节点矩形上的锚点：fx/fy 是 0~1 的比例（drawio 的 exitX/entryX） */
  const anchorOf = (node: MxNode, fx: number, fy: number) => {
    // drawio 的 centerPerimeter：不管 exit/entry 给什么比例，端口都在节点中心出线。
    // 图纸里的连接点（waypoint）就是这么连的，两条管线必须在同一点接上，否则会断开。
    const centerPort = node.style.perimeter === 'centerPerimeter';
    // 单元的 rotation（角度，顺时针）要作用在锚点上，否则旋转过的设备会连歪
    const beta = (mxNumber(node.style, 'rotation', 0) * Math.PI) / 180;
    const localX = ((centerPort ? 0.5 : fx) - 0.5) * node.width;
    const localY = ((centerPort ? 0.5 : fy) - 0.5) * node.height;
    const cos = Math.cos(beta);
    const sin = Math.sin(beta);
    return {
      x: node.x + node.width / 2 + localX * cos - localY * sin,
      y: node.y + node.height / 2 + localX * sin + localY * cos,
    };
  };

  /** 端口微调上限（世界单位）：绘图员的偏差都在这个量级内，超过就不挪图元、交给正交化的肘点 */
  const PORT_ALIGN_MAX = 12;
  /** 单元 → 建出来的图元（微调位置时要一并移动并重建索引） */
  const placedGraphics = new Map<
    string,
    { graphic: SelectableGraphic; kind: 'device' | 'valve' }
  >();
  /** 位号草稿：等图元位置定下来（可能微调）再落位 */
  const labelDrafts: Array<{ cellId: string; text: string; style: MxStyle }> = [];

  // 第一遍：图元（设备 / 阀门 / 连接点）与位号草稿
  for (const node of document.nodes) {
    // 跳过 drawio 的图层与根节点
    if (node.id === '0' || node.id === '1') continue;
    if (node.parentId) cellGroupId.set(node.id, node.parentId);
    if (node.isEdge) continue;

    if (node.width <= 0 || node.height <= 0) {
      stats.skipped += 1;
      continue;
    }

    // 纯连接点（drawio 的 shape=waypoint）：图纸里只作为接边用的节点，没有实际含义，
    // 所以只保留 id 让管线拓扑能串过去，不建成可绘制的图元
    if (node.style.shape === 'waypoint') {
      idOf(node.id);
      stats.connectionPoints += 1;
      continue;
    }

    const center = centerOf(node);
    // drawio 的 rotation 是角度；fillColor 是填充色（fill=none 或没写就是不绘制）
    const beta = (mxNumber(node.style, 'rotation', 0) * Math.PI) / 180;
    // flipH/flipV 用负缩放表达（贴图跟着镜像，和 drawio 一致）
    const sx = mxFlag(node.style, 'flipH') ? -node.width : node.width;
    const sy = mxFlag(node.style, 'flipV') ? -node.height : node.height;
    const iconUrl = node.style.image;
    // 阀门节点：内联图标命中「阀门图标」表 → 可选中（selectable 能力）+ 自带开/关状态
    const valveIcon = iconUrl?.startsWith('data:image') ? matchValveIcon(iconUrl) : null;
    if (valveIcon) {
      const valve = new ValveGraphic({
        id: idOf(node.id),
        x: center.x,
        y: center.y,
        width: sx,
        height: sy,
        rotation: beta,
        // 图纸里的阀门默认关闭；需要初始打开时由调用方显式传 valveOpen
        open: options.valveOpen ?? false,
        // 原始单元信息跟着图元走（纯属性，不参与绘制）
        data: {
          cellId: node.id,
          label: node.value.trim(),
          kind: 'valve',
          style: node.style,
        } satisfies DrawioCellData,
      });
      valve.clearDirty();
      scene.upsertValve(valve);
      placedGraphics.set(node.id, { graphic: valve, kind: 'valve' });
      if (node.parentId) groupValveId.set(node.parentId, valve.id);
      stats.valves += 1;
      // 画什么完全看图纸：阀门节点用它自己的内联图标（开/关态也由图纸这张图决定）
      icons.set(valve.id, normalizeIconUrl(iconUrl));
      stats.icons += 1;
    } else {
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
      placedGraphics.set(node.id, { graphic: device, kind: 'device' });
      stats.devices += 1;

      // 图标：drawio 的图片单元把 base64 放在 style.image 里，绘制端按它贴图
      if (iconUrl?.startsWith('data:image')) {
        icons.set(device.id, normalizeIconUrl(iconUrl));
        stats.icons += 1;
      }
    }

    const text = node.value.trim();
    if (text) labelDrafts.push({ cellId: node.id, text, style: node.style });
  }

  // 第二遍：先按图纸算出每条边的端口，收一下「把相连单元微调一点就能对齐」的诉求
  const cellShifts = new Map<string, { dx: number; dy: number }>();
  /** 同一个单元可能连多条边：把各条边的诉求收集起来，最后取中位数（避免只顾第一条边） */
  const cellDemands = new Map<string, { dx: number[]; dy: number[] }>();
  const portOf = (node: MxNode, fx: number, fy: number) => {
    const shift = cellShifts.get(node.id);
    const anchor = anchorOf(node, fx, fy);
    return { x: anchor.x + (shift?.dx ?? 0), y: anchor.y + (shift?.dy ?? 0) };
  };
  // 端口应当落在与相邻点同一条正交轴上：差得不多就把单元整体挪过去（图纸是手画的，允许微调图元），
  // 差得多则不动图元，交给随后的正交化插肘点。一个单元连多条边时取平均诉求，
  // 迭代几轮（每轮都用「已经挪过的位置」重新算），让整张网逐步拉平。
  const average = (values: readonly number[]): number =>
    values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;
  const runAlignRound = (): void => {
    cellDemands.clear();
    for (const node of document.nodes) {
      if (!node.isEdge) continue;
      const source = node.sourceId ? document.byId.get(node.sourceId) : undefined;
      const target = node.targetId ? document.byId.get(node.targetId) : undefined;
      if (!source || !target) continue;

      const exitX = mxNumber(node.style, 'exitX', 0.5);
      const exitY = mxNumber(node.style, 'exitY', 0.5);
      const entryX = mxNumber(node.style, 'entryX', 0.5);
      const entryY = mxNumber(node.style, 'entryY', 0.5);
      const requestShift = (cell: MxNode, port: Point, neighbor: Point, weight: number): void => {
        const dx = neighbor.x - port.x;
        const dy = neighbor.y - port.y;
        const horizontal = Math.abs(dx) >= Math.abs(dy);
        const shift = horizontal ? dy : dx;
        if (Math.abs(shift) > PORT_ALIGN_MAX) return;
        const demand = cellDemands.get(cell.id) ?? { dx: [], dy: [] };
        (horizontal ? demand.dy : demand.dx).push(shift * weight);
        cellDemands.set(cell.id, demand);
      };
      const hasWaypoints = node.points.length > 0;
      if (hasWaypoints) {
        // 有折点：折点是固定的，端口整段对齐过去
        requestShift(source, portOf(source, exitX, exitY), node.points[0], 1);
        requestShift(
          target,
          portOf(target, entryX, entryY),
          node.points[node.points.length - 1],
          1,
        );
      } else {
        // 两点直连：两端都是节点，各走一半，向中间那条正交线靠
        requestShift(source, portOf(source, exitX, exitY), portOf(target, entryX, entryY), 0.5);
        requestShift(target, portOf(target, entryX, entryY), portOf(source, exitX, exitY), 0.5);
      }
    }
    for (const [cellId, demand] of cellDemands) {
      const previous = cellShifts.get(cellId) ?? { dx: 0, dy: 0 };
      const dx = previous.dx + average(demand.dx);
      const dy = previous.dy + average(demand.dy);
      // 微调幅度封顶：图纸手画的偏差不大，但别让某个单元被拉太远
      const clamp = (value: number) => Math.max(-PORT_ALIGN_MAX, Math.min(PORT_ALIGN_MAX, value));
      cellShifts.set(cellId, { dx: clamp(dx), dy: clamp(dy) });
    }
  };
  for (let round = 0; round < 4; round += 1) runAlignRound();

  // 落位：微调单元（图元整体平移一点，重建空间索引），位号跟着单元中心走
  for (const [cellId, shift] of cellShifts) {
    const placed = placedGraphics.get(cellId);
    if (!placed) continue;
    placed.graphic.moveBy(shift.dx, shift.dy);
    if (placed.kind === 'valve') scene.upsertValve(placed.graphic as ValveGraphic);
    else scene.upsertDevice(placed.graphic);
  }
  for (const draft of labelDrafts) {
    const node = document.byId.get(draft.cellId);
    if (!node) continue;
    const shift = cellShifts.get(draft.cellId);
    const center = centerOf(node);
    labels.push({
      text: draft.text,
      x: center.x + (shift?.dx ?? 0),
      y: center.y + (shift?.dy ?? 0),
      color: parseDrawioColor(draft.style.fontColor) ?? DEFAULT_COLOR,
      fontSizePx: Math.max(10, Math.round(mxNumber(draft.style, 'fontSize', 12))),
    });
    stats.labels += 1;
  }

  // 第三遍：建管线（端口用微调后的位置，再按惯例横平竖直）
  for (const node of document.nodes) {
    if (!node.isEdge) continue;
    const source = node.sourceId ? document.byId.get(node.sourceId) : undefined;
    const target = node.targetId ? document.byId.get(node.targetId) : undefined;
    if (!source || !target) {
      stats.skipped += 1;
      continue;
    }
    const rawPoints = [
      portOf(source, mxNumber(node.style, 'exitX', 0.5), mxNumber(node.style, 'exitY', 0.5)),
      ...node.points,
      portOf(target, mxNumber(node.style, 'entryX', 0.5), mxNumber(node.style, 'entryY', 0.5)),
    ];
    if (rawPoints.length < 2) {
      stats.skipped += 1;
      continue;
    }
    // 管线按惯例横平竖直：近轴的拉正、斜线插肘点（对应 drawio 的 orthogonalEdgeStyle）。
    // 出口在左右两侧先水平走、在上下两侧先垂直走，与绘图员画线的走向一致。
    const exitX = mxNumber(node.style, 'exitX', 0.5);
    const exitY = mxNumber(node.style, 'exitY', 0.5);
    const points = orthogonalizePolyline(rawPoints, {
      preferHorizontalFirst: exitX !== 0.5 || exitY === 0.5,
    });
    // 管线粗细遵守图纸：XML 里 strokeWidth 是多少就画多少；没写按 draw.io 默认的 1px
    const lineWidthPx = mxNumber(node.style, 'strokeWidth', 1);
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
    if (node.sourceId && node.targetId) {
      pendingLinks.push({ pipeId: pipe.id, sourceId: node.sourceId, targetId: node.targetId });
    }
    stats.pipes += 1;
  }

  // 边建完后再解析端点：端点单元在阀门组里就挂到那个阀门上，否则用它自己的图元 id。
  // 链路保持 source → target 的方向，下游广播（applyValveFlowState）按这个方向走。
  const resolveElementId = (cellId: string): number | undefined => {
    const groupId = cellGroupId.get(cellId);
    const groupedValve = groupId ? groupValveId.get(groupId) : undefined;
    return groupedValve ?? numericIds.get(cellId);
  };
  for (const link of pendingLinks) {
    const sourceElementId = resolveElementId(link.sourceId);
    const targetElementId = resolveElementId(link.targetId);
    if (sourceElementId === undefined || targetElementId === undefined) continue;
    topology.setLink({ pipelineId: link.pipeId, sourceElementId, targetElementId });
  }

  return { scene, topology, labels, icons, bounds, stats };
}
