/**
 * PidScene 用例：三类图元的统一增删改、视口剔除与脏集合语义。
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { StressTestItem } from '@/business/pid_schematic/device_stress_test';
import { PidScene } from '@/business/pid_schematic/pid_scene';
import { createPipeItem } from '@/business/pid_schematic/pipe_line';
import type { ValveItem } from '@/business/pid_schematic/types';
import type { AABB } from '@/core/types';

const BOUNDS: AABB = { minX: -1000, minY: -1000, maxX: 1000, maxY: 1000 };
const VIEWPORT: AABB = { minX: -200, minY: -200, maxX: 200, maxY: 200 };
const FAR_VIEWPORT: AABB = { minX: 800, minY: 800, maxX: 900, maxY: 900 };

function makeDevice(id: number, x: number, y: number): StressTestItem {
  return {
    id,
    dirty: false,
    tx: x,
    ty: y,
    sx: 20,
    sy: 20,
    beta: 0,
    selected: 0,
    worldAABB: { minX: x - 10, minY: y - 10, maxX: x + 10, maxY: y + 10 },
  };
}

function makeValve(id: number, x: number, y: number): ValveItem {
  return {
    id,
    type: 'valve',
    tx: x,
    ty: y,
    sx: 40,
    sy: 40,
    beta: 0,
    selected: 0,
    valveOpen: 1,
    worldAABB: { minX: x - 20, minY: y - 20, maxX: x + 20, maxY: y + 20 },
  };
}

describe('PidScene', () => {
  it('三类图元各自可增删改，视口剔除按各自 AABB 生效', () => {
    const scene = new PidScene(BOUNDS);
    scene.upsertDevice(makeDevice(1, 0, 0));
    scene.upsertDevice(makeDevice(2, 900, 900)); // 视口外
    scene.upsertPipe(
      createPipeItem(
        11,
        [
          { x: 0, y: 0 },
          { x: 50, y: 0 },
        ],
        2,
      ),
    );
    scene.upsertValve(makeValve(21, 0, 50));

    const visible = scene.getVisible(VIEWPORT);
    assert.deepEqual(
      visible.devices.map((item) => item.id),
      [1],
    );
    assert.equal(visible.pipes.length, 1);
    assert.equal(visible.valves.length, 1);
    assert.equal(scene.getVisible(FAR_VIEWPORT).devices.length, 1, '远处视口只应命中设备 2');

    // 更新：把设备 1 移到视口外，查询结果随之变化
    scene.upsertDevice(makeDevice(1, 950, 950));
    assert.equal(scene.getVisible(VIEWPORT).devices.length, 0);

    // 删除：三类共用同一个 id 入口
    scene.remove(11);
    assert.equal(scene.getVisible(VIEWPORT).pipes.length, 0);
    scene.remove(999); // 不存在的 id 不应抛错
  });

  it('takeDirty 只返回变更过的 id，取出后清空', () => {
    const scene = new PidScene(BOUNDS);
    scene.upsertDevice(makeDevice(1, 0, 0));
    scene.upsertPipe(
      createPipeItem(
        11,
        [
          { x: 0, y: 0 },
          { x: 10, y: 0 },
        ],
        2,
      ),
    );
    scene.upsertValve(makeValve(21, 0, 0));

    const first = scene.takeDirty();
    assert.deepEqual(first.devices, [1]);
    assert.deepEqual(first.pipes, [11]);
    assert.deepEqual(first.valves, [21]);
    assert.deepEqual(scene.takeDirty(), { devices: [], pipes: [], valves: [] });

    scene.upsertValve(makeValve(21, 100, 0));
    const second = scene.takeDirty();
    assert.deepEqual(second.valves, [21], '只有被更新的阀门重新变脏');
    assert.deepEqual(second.devices, []);
  });

  it('clear 清空三类图元', () => {
    const scene = new PidScene(BOUNDS);
    scene.upsertDevice(makeDevice(1, 0, 0));
    scene.upsertValve(makeValve(21, 0, 0));
    scene.clear();
    const visible = scene.getVisible(VIEWPORT);
    assert.deepEqual(visible, { devices: [], pipes: [], valves: [] });
  });
});
