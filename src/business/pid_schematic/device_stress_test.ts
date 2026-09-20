import { QuadTree } from '@/core/geometry/quad_tree';
import { computeRotatedAABB } from '@/core/geometry/aabb';
import type { AABB, QuadTreeItem, RectInstance } from '@/core/types';

/** 压测矩形图元：四叉树索引字段 + 实例化渲染所需的 2D 变换 */
export interface StressTestItem extends QuadTreeItem {
  dirty: boolean;
  tx: number;
  ty: number;
  sx: number;
  sy: number;
  beta: number;
  selected: number; // 0=未选中，1=选中，float32对齐shader
}

export class DeviceStressTester {
  public readonly itemMap = new Map<number, StressTestItem>();
  public quadTree: QuadTree;
  public worldBounds: AABB;
  public moveRatio: number;

  private prevVisibleIds = new Set<number>();

  constructor(worldBounds: AABB, moveRatio = 0.002) {
    this.worldBounds = worldBounds;
    this.quadTree = new QuadTree(worldBounds);
    this.moveRatio = moveRatio;
  }

  /**
   * 批量生成模拟P&ID设备图元
   * @param count 总图元数量
   */
  generate(count: number) {
    const w = this.worldBounds.maxX - this.worldBounds.minX;
    const h = this.worldBounds.maxY - this.worldBounds.minY;

    this.itemMap.clear();
    this.quadTree = new QuadTree(this.worldBounds);

    for (let i = 0; i < count; i++) {
      const tx = this.worldBounds.minX + Math.random() * w;
      const ty = this.worldBounds.minY + Math.random() * h;
      const sx = 20 + Math.random() * 80;
      const sy = 20 + Math.random() * 80;
      const beta = Math.random() * Math.PI * 2;

      const worldAABB = computeRotatedAABB(tx, ty, sx, sy, beta);
      const item: StressTestItem = {
        id: i,
        dirty: false,
        tx,
        ty,
        sx,
        sy,
        beta,
        selected: 0, // ✅默认未选中
        worldAABB,
      };
      this.itemMap.set(i, item);
      this.quadTree.insert(item);
    }
    console.log(`✅ DeviceStressTester: 生成 ${count} 个模拟图元`);
  }

  /** ✅设置图元选中状态，拾取回调调用 */
  setItemSelected(id: number, isSelected: boolean) {
    const item = this.itemMap.get(id);
    if (!item) return;
    item.selected = isSelected ? 1 : 0;
    item.dirty = true;
  }

  /** ✅把可见 StressTestItem 数组，转为 Renderer2D 需要的 RectInstance[] */
  buildRectInstanceList(visibleItems: StressTestItem[]): RectInstance[] {
    return visibleItems.map((item) => ({
      sx: item.sx,
      sy: item.sy,
      beta: item.beta,
      tx: item.tx,
      ty: item.ty,
      selected: item.selected,
      u0: 0,
      v0: 0,
      u1: 1,
      v1: 1,
    }));
  }

  /**
   * 执行一帧tick，由外部render循环调用，不内部开raf
   * @param viewport 当前相机视口AABB
   * @returns {changed:boolean; visibleItems:StressTestItem[]}
   */
  tick(viewport: AABB, isDrag = false) {
    let geometryChanged = false;
    if (isDrag) {
      for (const item of this.itemMap.values()) {
        if (Math.random() < this.moveRatio) {
          item.tx += (Math.random() - 0.5) * 15;
          item.ty += (Math.random() - 0.5) * 15;
          item.beta += 0.002;
          item.dirty = true;
          geometryChanged = true;
        }
      }
    }

    // 处理脏图元，更新四叉树
    for (const item of this.itemMap.values()) {
      if (!item.dirty) continue;
      item.worldAABB = computeRotatedAABB(item.tx, item.ty, item.sx, item.sy, item.beta);
      this.quadTree.updateItem(item);
      item.dirty = false;
    }

    // 不管是否拖动，都执行视口查询，拿到可见图元
    const candidates = this.quadTree.queryViewport(viewport);
    const visibleItems: StressTestItem[] = [];
    for (const c of candidates) {
      const it = this.itemMap.get(c.id);
      if (it && QuadTree.intersect(it.worldAABB, viewport)) {
        visibleItems.push(it);
      }
    }

    const currIds = new Set(visibleItems.map((i) => i.id));
    const visibleSetChanged = !(
      currIds.size === this.prevVisibleIds.size &&
      [...currIds].every((id) => this.prevVisibleIds.has(id))
    );
    const changed = geometryChanged || visibleSetChanged;
    this.prevVisibleIds = currIds;

    return { changed, visibleItems };
  }

  /** 清空全部测试数据 */
  destroy() {
    this.itemMap.clear();
    this.prevVisibleIds.clear();
    this.quadTree = new QuadTree(this.worldBounds);
  }
}
