// aabb 包围盒树，四叉树

import type { AABB, QuadItem } from '@/engine/types';

class QuadTreeNode {
  bounds: AABB;
  capacity: number;
  items: QuadItem[];
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

  contains(item: QuadItem): boolean {
    const a = item.worldAABB;
    return (
      a.minX >= this.bounds.minX &&
      a.maxX <= this.bounds.maxX &&
      a.minY >= this.bounds.minY &&
      a.maxY <= this.bounds.maxY
    );
  }

  subdivide() {
    const { minX, minY, maxX, maxY } = this.bounds;
    const midX = (minX + maxX) / 2;
    const midY = (minY + maxY) / 2;

    this.nw = new QuadTreeNode({ minX, minY, maxX: midX, maxY: midY }, this.capacity);
    this.ne = new QuadTreeNode({ minX: midX, minY, maxX, maxY: midY }, this.capacity);
    this.sw = new QuadTreeNode({ minX, minY: midY, maxX: midX, maxY }, this.capacity);
    this.se = new QuadTreeNode({ minX: midX, minY: midY, maxX, maxY }, this.capacity);

    this.divided = true;

    for (const it of this.items) {
      this.insert(it);
    }
    this.items.length = 0;
  }

  insert(item: QuadItem): boolean {
    if (!this.contains(item)) return false;

    if (this.items.length < this.capacity) {
      this.items.push(item);
      return true;
    }

    if (!this.divided) {
      this.subdivide();
    }

    return (
      this.nw!.insert(item) ||
      this.ne!.insert(item) ||
      this.sw!.insert(item) ||
      this.se!.insert(item)
    );
  }

  query(range: AABB, out: QuadItem[] = []): QuadItem[] {
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

  removeById(id: number): boolean {
    const idx = this.items.findIndex((i) => i.id === id);
    if (idx !== -1) {
      this.items.splice(idx, 1);
      return true;
    }
    if (!this.divided) return false;
    return (
      this.nw!.removeById(id) ||
      this.ne!.removeById(id) ||
      this.sw!.removeById(id) ||
      this.se!.removeById(id)
    );
  }
}

export class QuadTree {
  root: QuadTreeNode;

  constructor(worldBounds: AABB) {
    this.root = new QuadTreeNode(worldBounds, 24);
  }

  insert(item: QuadItem) {
    this.root.insert(item);
  }

  updateItem(item: QuadItem) {
    this.root.removeById(item.id);
    this.root.insert(item);
  }

  remove(id: number) {
    this.root.removeById(id);
  }

  queryViewport(viewport: AABB): QuadItem[] {
    return this.root.query(viewport, []);
  }

  static intersect(a: AABB, b: AABB): boolean {
    return QuadTreeNode.intersect(a, b);
  }
}
