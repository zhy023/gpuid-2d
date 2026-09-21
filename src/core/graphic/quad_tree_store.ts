/**
 * 图元集合的内存索引：四叉树 + 脏标记（业务无关的机制层）。
 *
 * 只负责空间索引：增删改的统一入口 + 视口剔除。
 * 「哪些图元需要重画」属于渲染侧语义，由业务层自己维护脏集合，这里不掺和。
 */
import { QuadTree } from '@/core/geometry/quad_tree';
import type { AABB, QuadTreeItem } from '@/core/types';

export class QuadTreeStore<T extends QuadTreeItem> {
  private readonly worldBounds: AABB;
  private tree: QuadTree;
  private readonly items = new Map<number, T>();

  constructor(worldBounds: AABB) {
    // 注意：项目开启 erasableSyntaxOnly，不能用构造参数属性
    this.worldBounds = worldBounds;
    this.tree = new QuadTree(worldBounds);
  }

  /** 新增图元 */
  add(item: T): void {
    this.items.set(item.id, item);
    this.tree.insert(item);
  }

  /** 新增或更新（位置/尺寸/状态变化后调用） */
  update(item: T): void {
    if (!this.items.has(item.id)) {
      this.add(item);
      return;
    }
    this.items.set(item.id, item);
    this.tree.updateItem(item);
  }

  /** 删除图元 */
  remove(id: number): void {
    if (!this.items.delete(id)) return;
    this.tree.remove(id);
  }

  get(id: number): T | undefined {
    return this.items.get(id);
  }

  values(): IterableIterator<T> {
    return this.items.values();
  }

  get size(): number {
    return this.items.size;
  }

  /** 视口剔除：返回与视口相交的图元 */
  query(viewport: AABB): T[] {
    const result: T[] = [];
    for (const candidate of this.tree.queryViewport(viewport)) {
      const item = this.items.get(candidate.id);
      if (item) result.push(item);
    }
    return result;
  }

  clear(): void {
    this.items.clear();
    this.tree = new QuadTree(this.worldBounds);
  }
}
