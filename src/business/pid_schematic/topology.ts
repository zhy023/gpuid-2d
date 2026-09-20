/**
 * P&ID 拓扑：管线连接哪两个设备（阀门等），以及由阀门开闭推导下游管线的流动样式。
 */
import { setPipeFlow } from '@/business/pid_schematic/pipe_line';
import type { PipePolylineItem, ValveItem } from '@/business/pid_schematic/types';

export interface TopologyLink {
  /** 管线图元 id */
  pipelineId: number;
  /** 上游设备 id */
  sourceElementId: number;
  /** 下游设备 id */
  targetElementId: number;
}

export class Topology {
  private readonly links = new Map<number, TopologyLink>();
  // 以源设备为索引，便于从阀门沿流向向下游遍历
  private readonly linksBySource = new Map<number, TopologyLink[]>();

  setLink(link: TopologyLink): void {
    const previous = this.links.get(link.pipelineId);
    if (previous) this.detach(previous);

    this.links.set(link.pipelineId, link);
    const bucket = this.linksBySource.get(link.sourceElementId);
    if (bucket) bucket.push(link);
    else this.linksBySource.set(link.sourceElementId, [link]);
  }

  getLink(pipelineId: number): TopologyLink | undefined {
    return this.links.get(pipelineId);
  }

  removeLink(pipelineId: number): void {
    const link = this.links.get(pipelineId);
    if (!link) return;
    this.detach(link);
    this.links.delete(pipelineId);
  }

  /** 从某个设备沿流向直接连出的管线 */
  linksFrom(elementId: number): readonly TopologyLink[] {
    return this.linksBySource.get(elementId) ?? [];
  }

  values(): IterableIterator<TopologyLink> {
    return this.links.values();
  }

  clear(): void {
    this.links.clear();
    this.linksBySource.clear();
  }

  private detach(link: TopologyLink): void {
    const bucket = this.linksBySource.get(link.sourceElementId);
    if (!bucket) return;
    const index = bucket.indexOf(link);
    if (index !== -1) bucket.splice(index, 1);
    if (bucket.length === 0) this.linksBySource.delete(link.sourceElementId);
  }
}

/**
 * 阀门开闭 → 下游管线流动样式。
 *
 * 全量重算（图元数量级不大，逻辑简单可控）：
 *   1. 先把拓扑里的管线全部恢复流动样式
 *   2. 对每个关闭的阀门，沿流向把能到达的管线切回默认样式；
 *      途中遇到其它设备继续往下游走（那个设备自己的开关由它那一轮处理）
 *
 * @param topology 拓扑关系
 * @param valves 设备图元（阀门），读取 id 与 valveOpen
 * @param pipes 管线图元表，按 id 取
 */
export function applyValveFlowState(
  topology: Topology,
  valves: Iterable<ValveItem>,
  pipes: ReadonlyMap<number, PipePolylineItem>,
): void {
  for (const pipe of pipes.values()) {
    setPipeFlow(pipe, true);
  }

  for (const valve of valves) {
    if (valve.valveOpen > 0.5) continue;

    const visitedPipes = new Set<number>();
    const visitedElements = new Set<number>([valve.id]);
    const queue: number[] = [valve.id];

    while (queue.length > 0) {
      const elementId = queue.pop() as number;
      for (const link of topology.linksFrom(elementId)) {
        if (!visitedPipes.has(link.pipelineId)) {
          visitedPipes.add(link.pipelineId);
          const pipe = pipes.get(link.pipelineId);
          if (pipe) setPipeFlow(pipe, false);
        }
        // 环路保护：同一个设备只展开一次
        if (!visitedElements.has(link.targetElementId)) {
          visitedElements.add(link.targetElementId);
          queue.push(link.targetElementId);
        }
      }
    }
  }
}
