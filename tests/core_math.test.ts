/**
 * 核心几何与空间索引用例：
 * 1. computeRotatedAABB / hitTestRect 与手写实现等价（防止换 wgpu-matrix 后悄悄改了约定）
 * 2. 四叉树 insert/update/remove/query 与暴力过滤结果一致（防止 id→节点索引改错）
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Camera2d } from '@/core/camera';
import { computeRotatedAABB } from '@/core/geometry/aabb';
import { orthogonalizePolyline } from '@/core/geometry/polyline';
import { QuadTree } from '@/core/geometry/quad_tree';
import {
  composeProjection2d,
  PROJECTION_FLOAT_COUNT,
  screenToWorld2d,
  worldToScreen2d,
} from '@/core/geometry/transform_2d';
import type { AABB, QuadTreeItem } from '@/core/types';

/** 固定种子伪随机，保证用例可复现 */
function makeRandom(seed: number) {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
}

function legacyRotatedAABB(tx: number, ty: number, sx: number, sy: number, beta: number): AABB {
  const halfX = 0.5 * sx;
  const halfY = 0.5 * sy;
  const cos = Math.cos(beta);
  const sin = Math.sin(beta);
  const corners = [
    { x: -halfX, y: -halfY },
    { x: +halfX, y: -halfY },
    { x: +halfX, y: +halfY },
    { x: -halfX, y: +halfY },
  ];
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const p of corners) {
    const wx = p.x * cos - p.y * sin + tx;
    const wy = p.x * sin + p.y * cos + ty;
    minX = Math.min(minX, wx);
    maxX = Math.max(maxX, wx);
    minY = Math.min(minY, wy);
    maxY = Math.max(maxY, wy);
  }
  return { minX, minY, maxX, maxY };
}

function legacyHitTest(
  point: { x: number; y: number },
  sx: number,
  sy: number,
  beta: number,
  tx: number,
  ty: number,
): boolean {
  const dx = point.x - tx;
  const dy = point.y - ty;
  const cos = Math.cos(-beta);
  const sin = Math.sin(-beta);
  const lx = dx * cos - dy * sin;
  const ly = dx * sin + dy * cos;
  const u = lx / sx;
  const v = ly / sy;
  const eps = 1e-4;
  return u >= -0.5 - eps && u <= 0.5 + eps && v >= -0.5 - eps && v <= 0.5 + eps;
}

describe('computeRotatedAABB', () => {
  it('与手写实现逐字段一致（2000 组随机参数）', () => {
    const random = makeRandom(20240920);
    for (let i = 0; i < 2000; i += 1) {
      const tx = (random() - 0.5) * 20000;
      const ty = (random() - 0.5) * 20000;
      const sx = random() * 500 + 0.001;
      const sy = random() * 500 + 0.001;
      const beta = (random() - 0.5) * Math.PI * 2;

      const actual = computeRotatedAABB(tx, ty, sx, sy, beta);
      const expected = legacyRotatedAABB(tx, ty, sx, sy, beta);
      for (const key of ['minX', 'minY', 'maxX', 'maxY'] as const) {
        assert.ok(
          Math.abs(actual[key] - expected[key]) < 1e-9,
          `${key} 偏差过大：${actual[key]} vs ${expected[key]}`,
        );
      }
    }
  });
});

describe('orthogonalizePolyline（管线横平竖直）', () => {
  it('近水平 / 近垂直的段直接拉正，首点不动', () => {
    const points = orthogonalizePolyline([
      { x: 0, y: 0 },
      { x: 100, y: 2 } /* 差 1.1°，按容差拉平 */,
      { x: 103, y: 80 } /* 差 2°，按容差拉直（这是末点，固定不动 → 用短肘摆正） */,
    ]);
    assert.deepEqual(points[0], { x: 0, y: 0 }, '首点（吸附在设备上的端点）不动');
    assert.equal(points[1].y, 0, '水平段被拉平');
    const end = points[points.length - 1];
    assert.deepEqual(end, { x: 103, y: 80 }, '末点（端口）也固定不动');
    for (let index = 1; index < points.length; index += 1) {
      const dx = points[index].x - points[index - 1].x;
      const dy = points[index].y - points[index - 1].y;
      assert.ok(Math.abs(dx) < 1e-9 || Math.abs(dy) < 1e-9, '每段都横平竖直');
    }
  });

  it('真正的斜线段插入肘点，变成两段正交线', () => {
    /** 中间有一段真斜线（首末两点是端口，都不动） */
    const points = orthogonalizePolyline(
      [
        { x: 0, y: 0 },
        { x: 40, y: 0 },
        { x: 140, y: 100 },
        { x: 200, y: 100 },
      ],
      { preferHorizontalFirst: false },
    );
    assert.deepEqual(points[0], { x: 0, y: 0 });
    assert.deepEqual(points[points.length - 1], { x: 200, y: 100 });
    for (let index = 1; index < points.length; index += 1) {
      const dx = points[index].x - points[index - 1].x;
      const dy = points[index].y - points[index - 1].y;
      assert.ok(Math.abs(dx) < 1e-9 || Math.abs(dy) < 1e-9, '每段都横平竖直');
    }
    assert.ok(points.length > 4, '斜线段被拆成了两段（多出一个肘点）');
  });

  it('首末点（端口）不动：管线接头不会断开', () => {
    const points = orthogonalizePolyline([
      { x: 0, y: 0 },
      { x: 100, y: 30 } /* 近水平但不完全 */,
    ]);
    assert.deepEqual(points[0], { x: 0, y: 0 }, '首点固定');
    assert.deepEqual(points[points.length - 1], { x: 100, y: 30 }, '末点固定（端口在设备上）');
    for (let index = 1; index < points.length; index += 1) {
      const dx = points[index].x - points[index - 1].x;
      const dy = points[index].y - points[index - 1].y;
      assert.ok(Math.abs(dx) < 1e-9 || Math.abs(dy) < 1e-9, '每段仍然横平竖直');
    }
  });

  it('整理后每段都是横平竖直，且不产生重复点', () => {
    const points = orthogonalizePolyline([
      { x: 0, y: 0 },
      { x: 50, y: 0 },
      { x: 50.5, y: 40 },
      { x: 120, y: 40.4 },
    ]);
    for (let index = 1; index < points.length; index += 1) {
      const dx = points[index].x - points[index - 1].x;
      const dy = points[index].y - points[index - 1].y;
      assert.ok(
        Math.abs(dx) < 1e-9 || Math.abs(dy) < 1e-9,
        `第 ${index} 段应当横平竖直（dx=${dx}, dy=${dy}）`,
      );
    }
    for (let index = 1; index < points.length; index += 1) {
      assert.ok(
        Math.abs(points[index].x - points[index - 1].x) > 1e-9 ||
          Math.abs(points[index].y - points[index - 1].y) > 1e-9,
        '不应有重复点',
      );
    }
  });
});

describe('Camera2d.hitTestRect', () => {
  it('与手写实现结论一致（5000 组随机点）', () => {
    const random = makeRandom(7);
    for (let i = 0; i < 5000; i += 1) {
      const tx = (random() - 0.5) * 200;
      const ty = (random() - 0.5) * 200;
      const sx = random() * 100 + 0.5;
      const sy = random() * 100 + 0.5;
      const beta = (random() - 0.5) * Math.PI * 2;
      const point = { x: tx + (random() - 0.5) * 120, y: ty + (random() - 0.5) * 120 };

      assert.equal(
        Camera2d.hitTestRect(point, sx, sy, beta, tx, ty),
        legacyHitTest(point, sx, sy, beta, tx, ty),
        `命中结论不一致：point=${JSON.stringify(point)}`,
      );
    }
  });
});

describe('QuadTree', () => {
  const bounds: AABB = { minX: -1000, minY: -1000, maxX: 1000, maxY: 1000 };

  function makeItem(id: number, x: number, y: number, size = 20): QuadTreeItem {
    return {
      id,
      worldAABB: { minX: x - size / 2, minY: y - size / 2, maxX: x + size / 2, maxY: y + size / 2 },
    };
  }

  it('插入/移动/删除后，查询结果与暴力过滤一致', () => {
    const random = makeRandom(42);
    const tree = new QuadTree(bounds);
    const items: QuadTreeItem[] = [];
    for (let i = 0; i < 2000; i += 1) {
      const item = makeItem(i, (random() - 0.5) * 1800, (random() - 0.5) * 1800);
      items.push(item);
      tree.insert(item);
    }

    /** 移动前 200 个（updateItem = 删除 + 重新插入） */
    for (let i = 0; i < 200; i += 1) {
      const item = items[i];
      const cx = (random() - 0.5) * 1800;
      const cy = (random() - 0.5) * 1800;
      item.worldAABB = { minX: cx - 10, minY: cy - 10, maxX: cx + 10, maxY: cy + 10 };
      tree.updateItem(item);
    }

    /** 删除 100 个 */
    const removed = new Set<number>();
    for (let i = 300; i < 400; i += 1) {
      tree.remove(items[i].id);
      removed.add(items[i].id);
    }

    const viewport: AABB = { minX: -300, minY: -300, maxX: 300, maxY: 300 };
    const got = new Set(tree.queryViewport(viewport).map((item) => item.id));
    const expected = new Set(
      items
        .filter((item) => !removed.has(item.id))
        .filter(
          (item) =>
            !(
              item.worldAABB.maxX < viewport.minX ||
              item.worldAABB.minX > viewport.maxX ||
              item.worldAABB.maxY < viewport.minY ||
              item.worldAABB.minY > viewport.maxY
            ),
        )
        .map((item) => item.id),
    );

    assert.deepEqual(
      [...got].sort((a, b) => a - b),
      [...expected].sort((a, b) => a - b),
    );
    for (const id of removed) assert.ok(!got.has(id), `已删除的 ${id} 仍被查询到`);
  });
});

/**
 * 投影口径用例：CPU 与 GPU 共用同一套 3×3 正交投影（`composeProjection2d` 的输出
 * 直接喂 WGSL 的 mat3x3f），所以这里把「中心/边界映射」与「世界 y 向下」钉死；
 * 哪天有人改了方向约定，这几条会先红，而不是等到画面上下颠倒才发现。
 */
describe('composeProjection2d', () => {
  const view = { centerX: 100, centerY: -50, scale: 2 };
  const width = 800;
  const height = 600;
  const viewW = width / view.scale;
  const viewH = height / view.scale;

  /** 按列主序把世界点乘进投影矩阵（与 WGSL `mat3x3f * vec3f` 同一算法） */
  const project = (matrix: Float32Array, x: number, y: number) => ({
    x: matrix[0] * x + matrix[4] * y + matrix[8],
    y: matrix[1] * x + matrix[5] * y + matrix[9],
  });

  it('视口中心 → NDC 原点，四边 → ±1', () => {
    const m = composeProjection2d(view, width, height);
    const center = project(m, view.centerX, view.centerY);
    assert.ok(Math.abs(center.x) < 1e-6 && Math.abs(center.y) < 1e-6, '中心应落在 NDC 原点');

    assert.ok(Math.abs(project(m, view.centerX - viewW / 2, view.centerY).x + 1) < 1e-6);
    assert.ok(Math.abs(project(m, view.centerX + viewW / 2, view.centerY).x - 1) < 1e-6);
  });

  it('世界 y 向下：y 越大 NDC y 越负（屏幕越靠下）', () => {
    const m = composeProjection2d(view, width, height);
    const above = project(m, view.centerX, view.centerY - viewH / 2).y;
    const below = project(m, view.centerX, view.centerY + viewH / 2).y;
    assert.ok(Math.abs(above - 1) < 1e-6, `视口上边界应映射到 NDC y = +1，实际 ${above}`);
    assert.ok(Math.abs(below + 1) < 1e-6, `视口下边界应映射到 NDC y = -1，实际 ${below}`);
  });

  it('输出按 WGSL mat3x3f 的列对齐排布（每列补 1 个 float，共 12 个）', () => {
    const m = composeProjection2d(view, width, height);
    assert.equal(m.length, PROJECTION_FLOAT_COUNT);
    assert.deepEqual([m[3], m[7], m[11]], [0, 0, 0], '每列末尾是 16 字节对齐的填充');
    assert.deepEqual([m[2], m[6], m[10]], [0, 0, 1], '第三行是 (0, 0, 1)');
  });

  it('屏幕 ↔ 世界往返一致（相机拖拽/拾取都靠它）', () => {
    for (const [px, py] of [
      [0, 0],
      [width, 0],
      [width, height],
      [0, height],
      [123.5, 456.25],
    ]) {
      const world = screenToWorld2d(view, width, height, px, py);
      const back = worldToScreen2d(view, width, height, world.x, world.y);
      assert.ok(Math.abs(back.x - px) < 1e-6 && Math.abs(back.y - py) < 1e-6);
    }
    const center = worldToScreen2d(view, width, height, view.centerX, view.centerY);
    assert.deepEqual([center.x, center.y], [width / 2, height / 2]);
  });
});
