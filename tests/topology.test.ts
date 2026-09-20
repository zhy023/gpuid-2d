/**
 * 拓扑广播用例：阀门开闭如何沿拓扑决定下游管线的流动样式。
 * 这是业务语义的核心，之前只在临时脚本里验证过，现在沉淀成常驻用例。
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createPipeItem } from '@/business/pid_schematic/pipe_line';
import { Topology, applyValveFlowState } from '@/business/pid_schematic/topology';
import type { PipePolylineItem, ValveItem } from '@/business/pid_schematic/types';
import { createValveDemoScene, toggleValve } from '@/business/pid_schematic/valve_demo';

/** 把管线流动状态压成字符串，便于断言：1 = 流动，0 = 默认样式 */
function flowPattern(pipes: readonly PipePolylineItem[]): string {
  return pipes.map((pipe) => (pipe.flowSpeed > 0 ? 1 : 0)).join('');
}

function makeValve(id: number, valveOpen = 1): ValveItem {
  return {
    id,
    type: 'valve',
    tx: id * 100,
    ty: 0,
    sx: 40,
    sy: 40,
    beta: 0,
    selected: 0,
    valveOpen,
    worldAABB: { minX: id * 100 - 20, minY: -20, maxX: id * 100 + 20, maxY: 20 },
  };
}

describe('applyValveFlowState', () => {
  it('关闭阀门只影响其下游管线', () => {
    const scene = createValveDemoScene({ valveCount: 6, initialClosedIndex: 2 });
    // 阀门 2 关闭 → 管线 2、3、4 默认样式，管线 0、1 仍流动
    assert.equal(flowPattern([...scene.scene.pipes.values()]), '11000');
  });

  it('关闭更上游的阀门会覆盖下游的流动状态', () => {
    const scene = createValveDemoScene({ valveCount: 6, initialClosedIndex: 2 });
    toggleValve(scene, 200000);
    assert.equal(flowPattern([...scene.scene.pipes.values()]), '00000');
  });

  it('只打开下游阀门、上游仍关闭时不会恢复流动', () => {
    const scene = createValveDemoScene({ valveCount: 6, initialClosedIndex: 2 });
    toggleValve(scene, 200000);
    toggleValve(scene, 200002);
    assert.equal(flowPattern([...scene.scene.pipes.values()]), '00000');
  });

  it('上游阀门重新打开后整条链恢复流动', () => {
    const scene = createValveDemoScene({ valveCount: 6, initialClosedIndex: 2 });
    toggleValve(scene, 200000);
    toggleValve(scene, 200002);
    toggleValve(scene, 200000);
    assert.equal(flowPattern([...scene.scene.pipes.values()]), '11111');
  });

  it('环路拓扑不会死循环，且下游全部切为默认样式', () => {
    const topology = new Topology();
    const pipes = new Map<number, PipePolylineItem>();
    const pipeA = createPipeItem(
      11,
      [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
      ],
      2,
    );
    const pipeB = createPipeItem(
      12,
      [
        { x: 10, y: 0 },
        { x: 0, y: 0 },
      ],
      2,
    );
    pipes.set(pipeA.id, pipeA);
    pipes.set(pipeB.id, pipeB);
    topology.setLink({ pipelineId: 11, sourceElementId: 1, targetElementId: 2 });
    topology.setLink({ pipelineId: 12, sourceElementId: 2, targetElementId: 1 });

    const valves = [makeValve(1, 0), makeValve(2, 1)];
    applyValveFlowState(topology, valves, pipes);

    assert.equal(flowPattern([pipeA, pipeB]), '00');
  });

  it('拓扑里没有的管线不受影响', () => {
    const scene = createValveDemoScene({ valveCount: 4, initialClosedIndex: 1 });
    const loose = createPipeItem(
      999,
      [
        { x: 0, y: 0 },
        { x: 50, y: 0 },
      ],
      4,
    );
    scene.scene.upsertPipe(loose);
    applyValveFlowState(scene.topology, scene.scene.valves.values(), scene.scene.pipes);
    // loose 不在拓扑里，仍按「先全部恢复流动」保持流动
    assert.equal(loose.flowSpeed > 0, true);
  });
});
