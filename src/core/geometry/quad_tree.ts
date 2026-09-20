// aabb 包围盒树，四叉树

import type { AABB, QuadTreeItem } from '@/core/types';

class QuadTreeNode {
  bounds: AABB;
  capacity: number;
  items: QuadTreeItem[];
  divided: boolean;

  ne?: QuadTreeNode;
  nw?: QuadTreeNode;
  se?: QuadTreeNode;
  sw?: QuadTreeNode;

  constructor(bounds: AABB, capacity = 24) {
    this.bounds = bounds;
    this.capacity = capacity;
    this.items = [];
    this.divided = false;
  }

  static intersect(a: AABB, b: AABB): boolean {
    return !(a.maxX < b.minX || a.minX > b.maxX || a.maxY < b.minY || a.minY > b.maxY);
  }

  contains(item: QuadTreeItem): boolean {
    const a = item.worldAABB;
    return (
      a.minX >= this.bounds.minX &&
      a.maxX <= this.bounds.maxX &&
      a.minY >= this.bounds.minY &&
      a.maxY <= this.bounds.maxY
    );
  }

  subdivide(nodeIndex: Map<number, QuadTreeNode>) {
    const { minX, minY, maxX, maxY } = this.bounds;
    const midX = (minX + maxX) / 2;
    const midY = (minY + maxY) / 2;

    this.nw = new QuadTreeNode({ minX, minY, maxX: midX, maxY: midY }, this.capacity);
    this.ne = new QuadTreeNode({ minX: midX, minY, maxX, maxY: midY }, this.capacity);
    this.sw = new QuadTreeNode({ minX, minY: midY, maxX: midX, maxY }, this.capacity);
    this.se = new QuadTreeNode({ minX: midX, minY: midY, maxX, maxY }, this.capacity);

    this.divided = true;

    // 先取出再清空：跨界的图元会被重新放回 this.items，边遍历边插入会漏项/死循环
    const pending = [...this.items];
    this.items.length = 0;
    for (const it of pending) {
      this.insert(it, nodeIndex);
    }
  }

  insert(item: QuadTreeItem, nodeIndex: Map<number, QuadTreeNode>): boolean {
    if (!this.contains(item)) return false;

    if (!this.divided) {
      if (this.items.length < this.capacity) {
        this.items.push(item);
        // 记录归属节点：删除/更新时直接定位，无需全树遍历
        nodeIndex.set(item.id, this);
        return true;
      }
      this.subdivide(nodeIndex);
    }

    const inserted =
      this.nw!.insert(item, nodeIndex) ||
      this.ne!.insert(item, nodeIndex) ||
      this.sw!.insert(item, nodeIndex) ||
      this.se!.insert(item, nodeIndex);
    if (inserted) return true;

    // 图元跨象限边界：没有子节点能完整容纳它，留在本节点（允许超出容量），
    // 否则这个图元会被四叉树丢掉，导致剔除/拾取漏图元
    this.items.push(item);
    nodeIndex.set(item.id, this);
    return true;
  }

  /** 从本节点的 items 中摘除指定 id（调用方已通过索引定位到本节点） */
  detach(id: number): boolean {
    const index = this.items.findIndex((item) => item.id === id);
    if (index === -1) return false;
    this.items.splice(index, 1);
    return true;
  }

  query(range: AABB, out: QuadTreeItem[] = []): QuadTreeItem[] {
    if (!QuadTreeNode.intersect(this.bounds, range)) {
      return out;
    }

    for (const it of this.items) {
      if (QuadTreeNode.intersect(it.worldAABB, range)) {
        out.push(it);
      }
    }

    if (this.divided) {
      this.nw!.query(range, out);
      this.ne!.query(range, out);
      this.sw!.query(range, out);
      this.se!.query(range, out);
    }
    return out;
  }
}

export class QuadTree {
  root: QuadTreeNode;
  // id → 所属节点。更新图元（拖动时每帧上百次）时直接定位节点，
  // 避免原来递归全树查找：5 万图元下每次删除要访问上千个节点。
  private readonly nodeById = new Map<number, QuadTreeNode>();

  constructor(worldBounds: AABB) {
    this.root = new QuadTreeNode(worldBounds, 24);
  }

  insert(item: QuadTreeItem) {
    this.root.insert(item, this.nodeById);
  }

  updateItem(item: QuadTreeItem) {
    this.remove(item.id);
    this.root.insert(item, this.nodeById);
  }

  remove(id: number) {
    const node = this.nodeById.get(id);
    if (!node) return;
    node.detach(id);
    this.nodeById.delete(id);
  }

  queryViewport(viewport: AABB): QuadTreeItem[] {
    return this.root.query(viewport, []);
  }

  static intersect(a: AABB, b: AABB): boolean {
    return QuadTreeNode.intersect(a, b);
  }
}
