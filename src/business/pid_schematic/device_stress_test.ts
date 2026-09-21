/**
 * 设备图元压测：数据生成 + 每帧可见集与实例列表。
 *
 * 空间索引走 PidScene（内部是 core 的 QuadTreeStore）；「哪些图元需要重画」
 * 由本类自己维护（选中态或几何变化都会触发），索引层不掺和。
 * 因此 tick() 不再全量扫描 5 万条图元找 dirty。
 */
import { PidScene } from '@/business/pid_schematic/pid_scene';
import { Graphic } from '@/core/scene/graphic';
import type { AABB, RectInstance } from '@/core/types';

/** 设备图元 → 实例化绘制数据（几何 + 选中态 + 形状；uv 整张纹理、颜色取填充色） */
export function toRectInstances(items: readonly Graphic[]): RectInstance[] {
  return items.map((item) => ({
    sx: item.width,
    sy: item.height,
    beta: item.rotation,
    tx: item.x,
    ty: item.y,
    // 模型层是布尔，实例数据里按 float 传（着色器 > 0.5 判定）
    selected: item.selectedFlag,
    u0: 0,
    v0: 0,
    u1: 1,
    v1: 1,
    colorR: item.fillColor?.[0] ?? 0,
    colorG: item.fillColor?.[1] ?? 0,
    colorB: item.fillColor?.[2] ?? 0,
    colorA: item.fillColor?.[3] ?? 0,
    shape: item.shapeCode,
  }));
}

export class DeviceStressTester {
  public readonly itemMap = new Map<number, Graphic>();
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

      const item = new Graphic({
        id: i,
        x: tx,
        y: ty,
        width: sx,
        height: sy,
        rotation: beta,
      });
      // 刚生成、还未提交渲染，先清掉变更标记
      item.clearDirty();
      this.itemMap.set(i, item);
      this.scene.upsertDevice(item);
    }
    console.log(`✅ DeviceStressTester: 生成 ${count} 个模拟图元`);
  }

  /** 设置图元选中状态（拾取回调调用）：只标「需要重画」，不动空间索引 */
  setItemSelected(id: number, isSelected: boolean) {
    const item = this.itemMap.get(id);
    if (!item) return;
    item.setSelected(isSelected);
    this.renderDirtyIds.add(id);
  }

  /** 把可见设备图元转成 Renderer2D 需要的 RectInstance[] */
  buildRectInstanceList(visibleItems: Graphic[]): RectInstance[] {
    return toRectInstances(visibleItems);
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
        // 位置/旋转改动会打 dirty 并让包围盒失效，这里直接走图形基类的接口
        item.moveBy((Math.random() - 0.5) * 15, (Math.random() - 0.5) * 15);
        item.setRotation(item.rotation + 0.002);
        this.scene.upsertDevice(item);
        this.renderDirtyIds.add(item.id);
        geometryChanged = true;
      }
    }

    // 选中态等其他变更：只影响实例数据
    if (this.renderDirtyIds.size > 0) {
      for (const id of this.renderDirtyIds) {
        const item = this.itemMap.get(id);
        item?.clearDirty();
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
