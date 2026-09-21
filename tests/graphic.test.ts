/**
 * 图形基类用例：位置/大小/基本属性、节点与管线的状态语义，
 * 以及「图形可直接进四叉树」这条内核契约。
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createFlowPipe } from '@/business/pid_schematic/flow_pipe';
import { ValveGraphic } from '@/business/pid_schematic/valve_graphic';
import { NodeGraphic } from '@/core/scene/node_graphic';
import { RectNode } from '@/core/scene/rect_node';
import { QuadTreeStore } from '@/core/scene/quad_tree_store';
import type { AABB } from '@/core/types';

/** 取包围盒的小数位，便于断言 */
function round(box: AABB): AABB {
  const r = (value: number) => Number(value.toFixed(3));
  return { minX: r(box.minX), minY: r(box.minY), maxX: r(box.maxX), maxY: r(box.maxY) };
}

describe('Graphic（图形基类）', () => {
  it('位置/大小/旋转默认值 + 实例化契约别名', () => {
    const node = new RectNode({ id: 1 });
    assert.equal(node.x, 0);
    assert.equal(node.y, 0);
    assert.equal(node.width, 0);
    assert.equal(node.height, 0);
    assert.equal(node.rotation, 0);
    assert.equal(node.visible, true);
    assert.equal(node.selected, false);
    assert.equal(node.type, 'rect');

    node
      .setPosition(10, 20)
      .setSize(30, 40)
      .setRotation(Math.PI / 2);
    // 位置/大小/旋转与 tx/ty/sx/sy/beta 是同一份数据（实例化渲染契约字段）
    assert.deepEqual(
      [node.tx, node.ty, node.sx, node.sy, node.beta],
      [10, 20, 30, 40, Math.PI / 2],
    );
  });

  it('包围盒跟随几何变化，并且只在变化时失效缓存', () => {
    const node = new RectNode({ id: 1, x: 0, y: 0, width: 10, height: 10 });
    assert.deepEqual(round(node.worldAABB), { minX: -5, minY: -5, maxX: 5, maxY: 5 });

    // 旋转 90° 后仍然是同一块方形（宽高相等）
    node.setRotation(Math.PI / 2);
    assert.deepEqual(round(node.worldAABB), { minX: -5, minY: -5, maxX: 5, maxY: 5 });

    node.setSize(20, 10);
    // 此时已经转过 90°：20×10 变成 10×20 的包围盒
    assert.deepEqual(round(node.worldAABB), { minX: -5, minY: -10, maxX: 5, maxY: 10 });

    // 再转 45°，包围盒比轴对齐时更大
    node.setRotation(Math.PI / 4);
    const rotated = node.worldAABB;
    assert.ok(rotated.maxX > 5 && rotated.maxY > 10);

    // 平移只影响位置，不改变尺寸
    const width = rotated.maxX - rotated.minX;
    node.moveBy(100, 0);
    assert.equal(Number((node.worldAABB.maxX - node.worldAABB.minX - width).toFixed(6)), 0);
    assert.equal(Number(((node.worldAABB.minX + node.worldAABB.maxX) / 2).toFixed(6)), 100);
  });

  it('基本属性：可见性、选中态与变更标记', () => {
    const node = new RectNode({ id: 1 });
    node.clearDirty();
    assert.equal(node.dirty, false);

    node.setSelected(true);
    assert.equal(node.selected, true);
    assert.equal(node.selectedFlag, 1, '实例数据里选中态是 float');
    assert.equal(node.dirty, true, '状态变化要打变更标记');

    node.clearDirty();
    node.setVisible(false);
    assert.equal(node.visible, false);
    assert.equal(node.dirty, true);
    assert.equal(node.selectedFlag, 1);
  });
});

describe('NodeGraphic（节点基类）', () => {
  const background = [1, 0, 0, 1] as const;
  const border = [0, 0, 1, 1] as const;

  it('背景 / 边框 / 开关 / hover 状态', () => {
    const node = new RectNode({ id: 1, width: 10, height: 10 });
    assert.equal(node.backgroundColor, null);
    assert.equal(node.hasBorder, false);
    assert.equal(node.open, true, '默认打开');
    assert.equal(node.hovered, false);

    node.setBackground(background);
    node.setBorder(border, 2);
    assert.deepEqual(node.backgroundColor, background);
    assert.equal(node.hasBorder, true);

    node.setOpen(false);
    assert.equal(node.open, false);
    node.toggleOpen();
    assert.equal(node.open, true);

    node.setHovered(true);
    assert.equal(node.hovered, true);

    // 边框宽度为 0 视为不画边框
    node.setBorder(border, 0);
    assert.equal(node.hasBorder, false);
    // 子类可以继承：矩形节点就是节点基类的一种几何
    assert.ok(node instanceof NodeGraphic);
  });
});

describe('PipeGraphic（管线基类）', () => {
  it('包围盒由折线决定，改点即失效', () => {
    const pipe = createFlowPipe(1, [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
    ]);
    assert.deepEqual(round(pipe.worldAABB), { minX: 0, minY: 0, maxX: 100, maxY: 0 });

    pipe.setPoints([
      { x: 0, y: 0 },
      { x: 0, y: 50 },
    ]);
    assert.deepEqual(round(pipe.worldAABB), { minX: 0, minY: 0, maxX: 0, maxY: 50 });

    // 就地改点后显式通知一次，缓存同样会失效
    pipe.points[1].y = 80;
    pipe.markGeometryDirty();
    assert.equal(pipe.worldAABB.maxY, 80);
  });

  it('开关状态决定是否流动', () => {
    const pipe = createFlowPipe(1, [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
    ]);
    assert.equal(pipe.open, true);
    assert.equal(pipe.animated, true);
    assert.equal(pipe.currentAnimationSpeed, 1);

    pipe.setOpen(false);
    assert.equal(pipe.animated, false);
    assert.equal(pipe.currentAnimationSpeed, 0, '关闭时不流动');

    pipe.setAnimationSpeed(2);
    pipe.setOpen(true);
    assert.equal(pipe.currentAnimationSpeed, 2);

    pipe.advanceFlow(12.5);
    assert.equal(pipe.flowOffset, 12.5);
    // 折线几何变了，相位从 0 重新累计
    pipe.setPoints([
      { x: 0, y: 0 },
      { x: 20, y: 0 },
    ]);
    assert.equal(pipe.flowOffset, 0);
  });
});

describe('图形可直接进四叉树', () => {
  const BOUNDS: AABB = { minX: -1000, minY: -1000, maxX: 1000, maxY: 1000 };

  it('RectNode 插入/剔除/移动后重新查询', () => {
    const store = new QuadTreeStore<RectNode>(BOUNDS);
    const node = new RectNode({ id: 7, x: 0, y: 0, width: 20, height: 20 });
    store.add(node);

    const near: AABB = { minX: -50, minY: -50, maxX: 50, maxY: 50 };
    const far: AABB = { minX: 500, minY: 500, maxX: 600, maxY: 600 };
    assert.deepEqual(
      store.query(near).map((item) => item.id),
      [7],
    );
    assert.equal(store.query(far).length, 0);

    node.setPosition(550, 550);
    store.update(node);
    assert.equal(store.query(near).length, 0);
    assert.deepEqual(
      store.query(far).map((item) => item.id),
      [7],
    );
  });
});

describe('业务实现（阀门 / 流动管线）', () => {
  it('阀门：开闭走节点基类状态，valveOpen 是实例数据口径', () => {
    const valve = new ValveGraphic({ id: 1, x: 0, y: 0, width: 40, height: 40 });
    assert.equal(valve.type, 'valve');
    assert.equal(valve.valveOpen, 1);
    valve.toggleOpen();
    assert.equal(valve.open, false);
    assert.equal(valve.valveOpen, 0);
    // 阀门是节点基类的子类
    assert.ok(valve instanceof NodeGraphic);
  });

  it('流动管线：关闭 = 实心或静止虚线，打开 = 流动', () => {
    const pipe = createFlowPipe(1, [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
    ]);
    pipe.setOpen(false);
    assert.equal(pipe.flowSpeed, 0, '关闭且非虚线 → 实心默认样式');

    pipe.setDashed(true);
    assert.equal(pipe.flowSpeed, -1, '关闭的虚线 → 画条纹但不移动');

    pipe.setOpen(true);
    assert.equal(pipe.flowSpeed, 1, '打开 → 流动');
  });
});
