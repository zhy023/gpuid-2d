export interface TopologyLink {
  pipelineId: number;
  sourceElementId: number;
  targetElementId: number;
}

export class Topology {
  private readonly links = new Map<number, TopologyLink>();

  setLink(link: TopologyLink): void {
    this.links.set(link.pipelineId, link);
  }

  getLink(pipelineId: number): TopologyLink | undefined {
    return this.links.get(pipelineId);
  }

  removeLink(pipelineId: number): void {
    this.links.delete(pipelineId);
  }

  values(): IterableIterator<TopologyLink> {
    return this.links.values();
  }

  clear(): void {
    this.links.clear();
  }
}
