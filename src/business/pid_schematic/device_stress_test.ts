/**
 * 设备图元压测：数据生成 + 每帧可见集与实例列表。
 *
 * 空间索引走 PidScene（内部是 core 的 QuadTreeStore）；「哪些图元需要重画」
 * 由本类自己维护（选中态或几何变化都会触发），索引层不掺和。
 * 因此 tick() 不再全量扫描 5 万条图元找 dirty。
 */
import { PidScene } from '@/business/pid_schematic/pid_scene';
import { computeRotatedAABB } from '@/core/geometry/aabb';
import type { AABB, QuadTreeItem, RectInstance } from '@/core/types';

/** 压测矩形图元：空间索引字段 + 实例化渲染所需的 2D 变换 */
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
  public readonly scene: PidScene;
  public worldBounds: AABB;
  public moveRatio: number;

  /** 需要重建实例的图元（几何或选中态变化） */
  private readonly renderDirtyIds = new Set<number>();
  private prevVisibleIds = new Set<number>();

  constructor(worldBounds: AABB, moveRatio = 0.002) {
    this.worldBounds = worldBounds;
    this.scene = new PidScene(worldBounds);
    this.moveRatio = moveRatio;
  }

  /**
   * 批量生成模拟 P&ID 设备图元
   * @param count 总图元数量
   */
  generate(count: number) {
    const w = this.worldBounds.maxX - this.worldBounds.minX;
    const h = this.worldBounds.maxY - this.worldBounds.minY;

    this.itemMap.clear();
    this.scene.clear();
    this.renderDirtyIds.clear();

    for (let i = 0; i < count; i++) {
      const tx = this.worldBounds.minX + Math.random() * w;
      const ty = this.worldBounds.minY + Math.random() * h;
      const sx = 20 + Math.random() * 80;
      const sy = 20 + Math.random() * 80;
      const beta = Math.random() * Math.PI * 2;

      const item: StressTestItem = {
        id: i,
        dirty: false,
        tx,
        ty,
        sx,
        sy,
        beta,
        selected: 0,
        worldAABB: computeRotatedAABB(tx, ty, sx, sy, beta),
      };
      this.itemMap.set(i, item);
      this.scene.upsertDevice(item);
    }
    console.log(`✅ DeviceStressTester: 生成 ${count} 个模拟图元`);
  }

  /** 设置图元选中状态（拾取回调调用）：只标「需要重画」，不动空间索引 */
  setItemSelected(id: number, isSelected: boolean) {
    const item = this.itemMap.get(id);
    if (!item) return;
    item.selected = isSelected ? 1 : 0;
    item.dirty = true;
    this.renderDirtyIds.add(id);
  }

  /** 把可见 StressTestItem 数组转成 Renderer2D 需要的 RectInstance[] */
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
      colorR: 0,
      colorG: 0,
      colorB: 0,
      colorA: 0,
    }));
  }

  /**
   * 执行一帧 tick，由外部渲染循环调用（内部不开 rAF）
   * @param viewport 当前相机视口 AABB
   * @returns { changed, visibleItems }
   */
  tick(viewport: AABB, isDrag = false) {
    let geometryChanged = false;

    // 拖动时随机抖动：几何变了才需要更新索引
    if (isDrag) {
      for (const item of this.itemMap.values()) {
        if (Math.random() >= this.moveRatio) continue;
        item.tx += (Math.random() - 0.5) * 15;
        item.ty += (Math.random() - 0.5) * 15;
        item.beta += 0.002;
        item.worldAABB = computeRotatedAABB(item.tx, item.ty, item.sx, item.sy, item.beta);
        item.dirty = true;
        this.scene.upsertDevice(item);
        this.renderDirtyIds.add(item.id);
        geometryChanged = true;
      }
    }

    // 选中态等其他变更：只影响实例数据
    if (this.renderDirtyIds.size > 0) {
      for (const id of this.renderDirtyIds) {
        const item = this.itemMap.get(id);
        if (item) item.dirty = false;
      }
      this.renderDirtyIds.clear();
    }

    // 视口剔除（索引层已按 AABB 相交过滤）
    const visibleItems = this.scene.getVisible(viewport).devices;

    const currIds = new Set(visibleItems.map((item) => item.id));
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
    this.renderDirtyIds.clear();
    this.prevVisibleIds.clear();
    this.scene.clear();
  }
}
