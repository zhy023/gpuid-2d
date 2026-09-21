/**
 * PidScene 用例：三类图元的统一增删改、视口剔除与脏集合语义。
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createFlowPipe } from '@/business/pid_schematic/flow_pipe';
import { PidScene } from '@/business/pid_schematic/pid_scene';
import { ValveGraphic } from '@/business/pid_schematic/valve_graphic';
import { Graphic } from '@/core/scene/graphic';
import type { AABB } from '@/core/types';

const BOUNDS: AABB = { minX: -1000, minY: -1000, maxX: 1000, maxY: 1000 };
const VIEWPORT: AABB = { minX: -200, minY: -200, maxX: 200, maxY: 200 };
const FAR_VIEWPORT: AABB = { minX: 800, minY: 800, maxX: 900, maxY: 900 };

function makeDevice(id: number, x: number, y: number): Graphic {
  // 设备矩形就是最普通的图形：包围盒由位置/宽高自己算
  return new Graphic({ id, x, y, width: 20, height: 20 });
}

function makeValve(id: number, x: number, y: number): ValveGraphic {
  return new ValveGraphic({ id, x, y, width: 40, height: 40 });
}

describe('PidScene', () => {
  it('三类图元各自可增删改，视口剔除按各自 AABB 生效', () => {
    const scene = new PidScene(BOUNDS);
    scene.upsertDevice(makeDevice(1, 0, 0));
    scene.upsertDevice(makeDevice(2, 900, 900)); // 视口外
    scene.upsertPipe(
      createFlowPipe(
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

  it('clear 清空三类图元', () => {
    const scene = new PidScene(BOUNDS);
    scene.upsertDevice(makeDevice(1, 0, 0));
    scene.upsertValve(makeValve(21, 0, 0));
    scene.clear();
    const visible = scene.getVisible(VIEWPORT);
    assert.deepEqual(visible, { devices: [], pipes: [], valves: [] });
  });
});
