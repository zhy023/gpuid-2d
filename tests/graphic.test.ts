/**
 * 图形基类用例：只有这一层抽象，形状靠绘制命令区分（PixiJS 的 Graphics 用法），
 * 覆盖位置/大小/外观/状态/动画、形状与包围盒、以及「图形可直接进四叉树」。
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createFlowPipe } from '@/business/pid_schematic/flow_pipe';
import { ValveGraphic } from '@/business/pid_schematic/valve_graphic';
import {
  GRAPHIC_SHAPE_CIRCLE,
  GRAPHIC_SHAPE_RECT,
  GRAPHIC_SHAPE_TRIANGLE,
  Graphic,
} from '@/core/scene/graphic';
import { QuadTreeStore } from '@/core/scene/quad_tree_store';
import { packInstances } from '@/core/gpu/renderer';
import { toInstances } from '@/business/pid_schematic/device_stress_test';
import type { AABB } from '@/core/types';

const RED = [1, 0, 0, 1] as const;
const BLUE = [0, 0, 1, 1] as const;

/** 取包围盒的小数位，便于断言 */
function round(box: AABB): AABB {
  const r = (value: number) => Number(value.toFixed(3));
  return { minX: r(box.minX), minY: r(box.minY), maxX: r(box.maxX), maxY: r(box.maxY) };
}

describe('Graphic（图形基类）', () => {
  it('位置/大小/旋转默认值 + 实例化契约别名', () => {
    const g = new Graphic({ id: 1 });
    assert.equal(g.x, 0);
    assert.equal(g.y, 0);
    assert.equal(g.width, 0);
    assert.equal(g.height, 0);
    assert.equal(g.rotation, 0);
    assert.equal(g.visible, true);
    assert.equal(g.selected, false);
    assert.equal(g.shape, 'rect');

    g.setPosition(10, 20)
      .setSize(30, 40)
      .setRotation(Math.PI / 2);
    // 位置/大小/旋转与 tx/ty/sx/sy/beta 是同一份数据（实例化渲染契约字段）
    assert.deepEqual([g.tx, g.ty, g.sx, g.sy, g.beta], [10, 20, 30, 40, Math.PI / 2]);
  });

  it('绘制命令：正方形/长方形/圆/三角形，返回自身可链式调用', () => {
    const square = new Graphic({ id: 1 }).square(80);
    assert.equal(square.width, 80);
    assert.equal(square.height, 80);

    const rectangle = new Graphic({ id: 2 }).rect(120, 60);
    assert.equal(rectangle.width, 120);
    assert.equal(rectangle.height, 60);

    // 圆形：宽高相等是正圆，宽高不等就是椭圆（内切于包围盒）
    const circle = new Graphic({ id: 3 }).circle(50);
    assert.equal(circle.shape, 'circle');
    assert.equal(circle.shapeCode, GRAPHIC_SHAPE_CIRCLE);
    const ellipse = new Graphic({ id: 4 }).ellipse(120, 60);
    assert.equal(ellipse.shapeCode, GRAPHIC_SHAPE_CIRCLE);

    // 三角形：内切于包围盒（底边在下、尖端在上），宽高可不等，朝向靠 rotation
    const triangle = new Graphic({ id: 6 }).triangle(60, 40);
    assert.equal(triangle.shape, 'triangle');
    assert.equal(triangle.shapeCode, GRAPHIC_SHAPE_TRIANGLE);
    assert.equal(triangle.width, 60);
    assert.equal(triangle.height, 40);

    const chain = new Graphic({ id: 5 }).rect(10, 10).fill(RED).stroke(BLUE, 2);
    assert.deepEqual(chain.fillColor, RED);
    assert.equal(chain.hasStroke, true);
    assert.equal(square.shapeCode, GRAPHIC_SHAPE_RECT);
  });

  it('折线：形状换成折线后包围盒按折线算', () => {
    const g = new Graphic({ id: 1 });
    g.polyline(
      [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
      ],
      6,
    );
    assert.equal(g.shape, 'polyline');
    assert.equal(g.lineWidthPx, 6);
    assert.deepEqual(round(g.worldAABB), { minX: 0, minY: 0, maxX: 100, maxY: 0 });

    g.setPoints([
      { x: 0, y: 0 },
      { x: 0, y: 50 },
    ]);
    assert.deepEqual(round(g.worldAABB), { minX: 0, minY: 0, maxX: 0, maxY: 50 });

    // 就地改点后显式通知一次，缓存同样失效
    g.points[1].y = 80;
    g.markGeometryDirty();
    assert.equal(g.worldAABB.maxY, 80);
  });

  it('包围盒跟随几何变化，并缓存结果', () => {
    const g = new Graphic({ id: 1, x: 0, y: 0, width: 10, height: 10 });
    assert.deepEqual(round(g.worldAABB), { minX: -5, minY: -5, maxX: 5, maxY: 5 });

    // 正方形转 90° 后包围盒不变
    g.setRotation(Math.PI / 2);
    assert.deepEqual(round(g.worldAABB), { minX: -5, minY: -5, maxX: 5, maxY: 5 });

    g.setSize(20, 10);
    // 此时已经转过 90°：20×10 变成 10×20 的包围盒
    assert.deepEqual(round(g.worldAABB), { minX: -5, minY: -10, maxX: 5, maxY: 10 });

    // 再转 45°，包围盒比轴对齐时更大
    g.setRotation(Math.PI / 4);
    const rotated = g.worldAABB;
    assert.ok(rotated.maxX > 5 && rotated.maxY > 10);

    // 平移只影响位置，不改变尺寸
    const width = rotated.maxX - rotated.minX;
    g.moveBy(100, 0);
    assert.equal(Number((g.worldAABB.maxX - g.worldAABB.minX - width).toFixed(6)), 0);
    assert.equal(Number(((g.worldAABB.minX + g.worldAABB.maxX) / 2).toFixed(6)), 100);
  });

  it('基本属性：可见性、选中态与变更标记', () => {
    const g = new Graphic({ id: 1 });
    g.clearDirty();
    assert.equal(g.dirty, false);

    g.setSelected(true);
    assert.equal(g.selected, true);
    assert.equal(g.selectedFlag, 1, '实例数据里选中态是 float');
    assert.equal(g.dirty, true, '状态变化要打变更标记');

    g.clearDirty();
    g.setVisible(false);
    assert.equal(g.visible, false);
    assert.equal(g.dirty, true);
    assert.equal(g.selectedFlag, 1);
  });

  it('外观：填充与描边', () => {
    const g = new Graphic({ id: 1, width: 10, height: 10 });
    assert.equal(g.fillColor, null);
    assert.equal(g.hasStroke, false);

    g.fill(RED).stroke(BLUE, 2);
    assert.deepEqual(g.fillColor, RED);
    assert.equal(g.hasStroke, true);

    // 宽度为 0 / 颜色为 null 都视为不描边
    g.stroke(BLUE, 0);
    assert.equal(g.hasStroke, false);
    g.noFill();
    assert.equal(g.fillColor, null);
  });

  it('状态与动画：开关决定动不动，hover 只是状态', () => {
    const g = new Graphic({ id: 1, animationSpeed: 2 });
    assert.equal(g.open, true, '默认打开');
    assert.equal(g.hovered, false);
    assert.equal(g.animated, true);
    assert.equal(g.currentAnimationSpeed, 2);

    g.setOpen(false);
    assert.equal(g.animated, false);
    assert.equal(g.currentAnimationSpeed, 0, '关闭时不推进动画');

    g.toggleOpen();
    assert.equal(g.open, true);

    g.setHovered(true);
    assert.equal(g.hovered, true);

    g.advanceFlow(12.5);
    assert.equal(g.flowOffset, 12.5);
  });
});

describe('图形可直接进四叉树', () => {
  const BOUNDS: AABB = { minX: -1000, minY: -1000, maxX: 1000, maxY: 1000 };

  it('插入/剔除/移动后重新查询', () => {
    const store = new QuadTreeStore<Graphic>(BOUNDS);
    const g = new Graphic({ id: 7, x: 0, y: 0 }).rect(20, 20);
    store.add(g);

    const near: AABB = { minX: -50, minY: -50, maxX: 50, maxY: 50 };
    const far: AABB = { minX: 500, minY: 500, maxX: 600, maxY: 600 };
    assert.deepEqual(
      store.query(near).map((item) => item.id),
      [7],
    );
    assert.equal(store.query(far).length, 0);

    g.setPosition(550, 550);
    store.update(g);
    assert.equal(store.query(near).length, 0);
    assert.deepEqual(
      store.query(far).map((item) => item.id),
      [7],
    );
  });
});

describe('外观 → 实例数据', () => {
  it('形状与填充色都写进实例（shape 通道 = 第 7 个 float）', () => {
    const circle = new Graphic({ id: 1, x: 0, y: 0 }).circle(50).fill(RED);
    const [instance] = toInstances([circle]);
    assert.equal(instance.shape, GRAPHIC_SHAPE_CIRCLE);
    assert.equal(instance.colorR, 1, '填充色进逐实例颜色通道');

    // 16 个 float/实例：0-1 缩放、2 旋转、3-4 位置、5 选中、6 形状
    const packed = packInstances([instance]);
    assert.equal(packed[6], GRAPHIC_SHAPE_CIRCLE, 'shape 落在第 7 个 float');
    assert.equal(packed[12], 1);
    assert.equal(packed.length, 16);

    const rect = new Graphic({ id: 2 }).rect(20, 10);
    assert.equal(toInstances([rect])[0].shape, GRAPHIC_SHAPE_RECT);

    const triangle = new Graphic({ id: 3 }).triangle(30, 20);
    assert.equal(toInstances([triangle])[0].shape, GRAPHIC_SHAPE_TRIANGLE);
  });
});

describe('业务实现（阀门 / 流动管线）', () => {
  it('阀门：开闭走图形基类状态，valveOpen 是实例数据口径', () => {
    const valve = new ValveGraphic({ id: 1, x: 0, y: 0, width: 40, height: 40 });
    // 阀门符号用方框模板画，业务分类由类本身表达，内核不感知
    assert.equal(valve.shape, 'rect');
    assert.equal(valve.valveOpen, 1);
    valve.toggleOpen();
    assert.equal(valve.open, false);
    assert.equal(valve.valveOpen, 0);
    assert.ok(valve instanceof Graphic);
  });

  it('流动管线：关闭 = 实心或静止虚线，打开 = 流动', () => {
    const pipe = createFlowPipe(1, [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
    ]);
    assert.equal(pipe.shape, 'polyline');
    pipe.setOpen(false);
    assert.equal(pipe.flowSpeed, 0, '关闭且非虚线 → 实心默认样式');

    pipe.setDashed(true);
    assert.equal(pipe.flowSpeed, -1, '关闭的虚线 → 画条纹但不移动');

    pipe.setOpen(true);
    assert.equal(pipe.flowSpeed, 1, '打开 → 流动');
  });
});
