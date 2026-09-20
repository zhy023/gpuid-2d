/**
 * 阀门示例场景：一条「阀门—管线—阀门」链 + 拓扑关系，
 * 用来演示阀门开闭沿拓扑把下游管线切回默认样式（关闭的阀门符号画红叉）。
 */
import { createPipeItem } from '@/business/pid_schematic/pipe_line';
import { applyValveFlowState, Topology } from '@/business/pid_schematic/topology';
import type { PipePolylineItem, ValveItem } from '@/business/pid_schematic/types';
import { computeRotatedAABB } from '@/core/geometry/aabb';

export interface ValveDemoScene {
  valves: ValveItem[];
  pipes: PipePolylineItem[];
  pipeMap: Map<number, PipePolylineItem>;
  topology: Topology;
}

export interface ValveDemoOptions {
  valveCount?: number;
  startX?: number;
  centerY?: number;
  /** 阀门中心间距（世界单位） */
  spacing?: number;
  symbolSize?: number;
  pipeWidthPx?: number;
  /** 初始关闭的阀门下标，默认 3：不用交互也能看到关闭阀门及其下游的默认样式 */
  initialClosedIndex?: number;
}

// 阀门与示例管线的 id 从高位开始，避开压测图元的 id 区间
const VALVE_ID_BASE = 200_000;
const PIPE_ID_BASE = 300_000;

export function createValveDemoScene(options: ValveDemoOptions = {}): ValveDemoScene {
  const {
    valveCount = 8,
    startX = -1400,
    centerY = 0,
    spacing = 400,
    symbolSize = 160,
    pipeWidthPx = 8,
    initialClosedIndex = 3,
  } = options;

  const halfSymbol = symbolSize / 2;
  const valves: ValveItem[] = [];
  const pipes: PipePolylineItem[] = [];
  const pipeMap = new Map<number, PipePolylineItem>();
  const topology = new Topology();

  for (let index = 0; index < valveCount; index += 1) {
    const tx = startX + index * spacing;
    valves.push({
      id: VALVE_ID_BASE + index,
      type: 'valve',
      tx,
      ty: centerY,
      sx: symbolSize,
      sy: symbolSize,
      beta: 0,
      selected: 0,
      valveOpen: 1,
      worldAABB: computeRotatedAABB(tx, centerY, symbolSize, symbolSize, 0),
    });
  }

  // 相邻阀门之间接一条横管线，端点在阀门边缘，避免符号与管道重叠
  for (let index = 1; index < valveCount; index += 1) {
    const from = valves[index - 1];
    const to = valves[index];
    const pipe = createPipeItem(
      PIPE_ID_BASE + index,
      [
        { x: from.tx + halfSymbol, y: centerY },
        { x: to.tx - halfSymbol, y: centerY },
      ],
      pipeWidthPx,
    );
    pipes.push(pipe);
    pipeMap.set(pipe.id, pipe);
    topology.setLink({
      pipelineId: pipe.id,
      sourceElementId: from.id,
      targetElementId: to.id,
    });
  }

  if (initialClosedIndex >= 0 && initialClosedIndex < valveCount) {
    valves[initialClosedIndex].valveOpen = 0;
  }
  applyValveFlowState(topology, valves, pipeMap);

  return { valves, pipes, pipeMap, topology };
}

/** 切换阀门开闭，并把下游管线切到对应样式 */
export function toggleValve(scene: ValveDemoScene, valveId: number): ValveItem | null {
  const valve = scene.valves.find((item) => item.id === valveId);
  if (!valve) return null;

  valve.valveOpen = valve.valveOpen > 0.5 ? 0 : 1;
  applyValveFlowState(scene.topology, scene.valves, scene.pipeMap);
  return valve;
}
