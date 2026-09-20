import { QuadTree } from '@/engine/geometry/quad_tree';
import type { AABB } from '@/engine/types';
import { initPipe } from '@/scene/pipeline_manager';
import { createPipeItem, rebuildPipeGeometry, computePipeAABB } from '@/scene/pipeline_line';

export type PipeTestItem = ReturnType<typeof createPipeItem>;

export class PipeStressTester {
  public readonly itemMap = new Map<number, PipeTestItem>();
  public quadTree: QuadTree;
  public worldBounds: AABB;
  public moveRatio: number;

  private prevVisibleItems: PipeTestItem[] = [];
  private prevSize = 0;
  private pipeInitialized = false;

  constructor(worldBounds: AABB, moveRatio = 0.001) {
    this.worldBounds = worldBounds;
    this.quadTree = new QuadTree(worldBounds);
    this.moveRatio = moveRatio;
  }

  async generate(count: number, device: GPUDevice) {
    if (!this.pipeInitialized) {
      await initPipe(device);
      this.pipeInitialized = true;
    }

    const w = this.worldBounds.maxX - this.worldBounds.minX;
    const h = this.worldBounds.maxY - this.worldBounds.minY;

    this.itemMap.clear();
    this.quadTree = new QuadTree(this.worldBounds);

    for (let i = 0; i < count; i++) {
      const sx = this.worldBounds.minX + Math.random() * w;
      const sy = this.worldBounds.minY + Math.random() * h;

      const pointCount = 2 + Math.floor(Math.random() * 4);
      const points: Array<{ x: number; y: number }> = [];
      let cx = sx;
      let cy = sy;
      for (let p = 0; p < pointCount; p++) {
        points.push({ x: cx, y: cy });
        cx += (Math.random() - 0.5) * 180;
        cy += (Math.random() - 0.5) * 180;
      }
      const lineWidth = 8 + Math.random() * 12;

      const pipeItem = createPipeItem(i, points, lineWidth);
      pipeItem.dirty = false;
      rebuildPipeGeometry(pipeItem);
      pipeItem.worldAABB = computePipeAABB(pipeItem);

      this.itemMap.set(i, pipeItem);
      this.quadTree.insert(pipeItem);
    }

    console.log(`✅ PipeStressTester: 生成 ${count} 根测试管线`);
  }

  tick(viewport: AABB, isDrag = false) {
    if (!isDrag) {
      // 非拖动：随机扰动管线顶点
      for (const item of this.itemMap.values()) {
        if (Math.random() < this.moveRatio) {
          for (const pt of item.points) {
            pt.x += (Math.random() - 0.5) * 6;
            pt.y += (Math.random() - 0.5) * 6;
          }
          item.dirty = true;
        }
      }
      // 脏管线重建几何，更新四叉树
      for (const item of this.itemMap.values()) {
        if (!item.dirty) continue;
        rebuildPipeGeometry(item);
        item.worldAABB = computePipeAABB(item);
        this.quadTree.updateItem(item);
        item.dirty = false;
      }
    }

    const candidates = this.quadTree.queryViewport(viewport);
    const visibleItems: PipeTestItem[] = [];
    for (const c of candidates) {
      const it = this.itemMap.get(c.id);
      if (it) {
        visibleItems.push(it);
      }
    }

    let changed = false;
    if (visibleItems.length !== this.prevSize) {
      changed = true;
    } else {
      const oldFirst = this.prevVisibleItems[0];
      const newFirst = visibleItems[0];
      const oldLast = this.prevVisibleItems.at(-1);
      const newLast = visibleItems.at(-1);
      if (oldFirst?.id !== newFirst?.id || oldLast?.id !== newLast?.id) {
        changed = true;
      }
    }

    if (changed) {
      this.prevVisibleItems = visibleItems;
      this.prevSize = visibleItems.length;
    }

    return { changed, visibleItems };
  }

  destroy() {
    this.itemMap.clear();
    this.prevVisibleItems = [];
    this.prevSize = 0;
    this.quadTree = new QuadTree(this.worldBounds);
  }
}
