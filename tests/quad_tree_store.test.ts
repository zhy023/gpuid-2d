/**
 * QuadTreeStore 用例：增删改后的查询与暴力过滤一致，脏集合语义正确。
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { QuadTreeStore } from '@/core/scene/spatial/quad_tree_store';
import type { AABB, QuadTreeItem } from '@/core/types';

const BOUNDS: AABB = { minX: -1000, minY: -1000, maxX: 1000, maxY: 1000 };
const VIEWPORT: AABB = { minX: -300, minY: -300, maxX: 300, maxY: 300 };

function makeRandom(seed: number) {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
}

function makeItem(id: number, x: number, y: number): QuadTreeItem {
  return {
    id,
    worldAABB: { minX: x - 10, minY: y - 10, maxX: x + 10, maxY: y + 10 },
  };
}

function intersects(a: AABB, b: AABB): boolean {
  return !(a.maxX < b.minX || a.minX > b.maxX || a.maxY < b.minY || a.minY > b.maxY);
}

describe('QuadTreeStore', () => {
  it('增删改后查询与暴力过滤一致，且删除项不再命中', () => {
    const random = makeRandom(2024);
    const store = new QuadTreeStore<QuadTreeItem>(BOUNDS);

    for (let i = 0; i < 2000; i += 1) {
      store.add(makeItem(i, (random() - 0.5) * 1800, (random() - 0.5) * 1800));
    }

    /** 移动前 300 个 */
    for (let i = 0; i < 300; i += 1) {
      const item = store.get(i);
      assert.ok(item);
      store.update(makeItem(i, (random() - 0.5) * 1800, (random() - 0.5) * 1800));
    }

    /** 删除 200 个 */
    const removed = new Set<number>();
    for (let i = 500; i < 700; i += 1) {
      store.remove(i);
      removed.add(i);
    }

    const got = new Set(store.query(VIEWPORT).map((item) => item.id));
    const expected = new Set(
      [...store.values()]
        .filter((item) => !removed.has(item.id) && intersects(item.worldAABB, VIEWPORT))
        .map((item) => item.id),
    );

    assert.deepEqual(
      [...got].sort((a, b) => a - b),
      [...expected].sort((a, b) => a - b),
    );
    assert.equal(store.size, 2000 - removed.size);
    for (const id of removed) assert.equal(store.get(id), undefined);
  });

  it('clear 之后索引与数据都清空', () => {
    const store = new QuadTreeStore<QuadTreeItem>(BOUNDS);
    store.add(makeItem(1, 0, 0));
    store.clear();
    assert.equal(store.size, 0);
    assert.deepEqual(store.query(VIEWPORT), []);
  });
});
