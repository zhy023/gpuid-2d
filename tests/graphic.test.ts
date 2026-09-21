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
  toInstances,
} from '@/core/scene/graphic/graphic';
import { DataGraphic } from '@/core/scene/graphic/data';
import { FlowGraphic } from '@/core/scene/capability/flow';
import { GraphicBase } from '@/core/scene/graphic/base';
import { SelectableGraphic } from '@/core/scene/capability/selectable';
import { QuadTreeStore } from '@/core/scene/spatial/quad_tree_store';
import { packInstances } from '@/core/gpu/renderer';
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
    assert.equal(g.shape, 'rect');
    // 绘制层不带选中/流动：那是图形与管线各自的能力
    assert.equal('selected' in g, false, 'Graphic 没有选中能力');
    assert.equal('open' in g, false, 'Graphic 没有流动状态');

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

  it('基本属性：可见性与变更标记（基础层）', () => {
    const g = new Graphic({ id: 1 });
    g.clearDirty();
    assert.equal(g.dirty, false);

    g.setVisible(false);
    assert.equal(g.visible, false);
    assert.equal(g.dirty, true, '状态变化要打变更标记');
  });

  it('图形能力：可选中 / 可取消选中 / hover（不带流动状态）', () => {
    const node = new SelectableGraphic({ id: 1, width: 10, height: 10 });
    assert.equal(node.selected, false, '默认未选中');
    assert.equal(node.selectedFlag, 0);
    assert.equal('open' in node, false, '图形没有流动状态');

    node.clearDirty();
    node.setSelected(true);
    assert.equal(node.selected, true);
    assert.equal(node.selectedFlag, 1, '实例数据里选中态是 float');
    assert.equal(node.dirty, true, '选中态变化要打变更标记');
    assert.equal(node.toInstance().selected, 1, '选中态进实例');

    node.clearSelection();
    assert.equal(node.selected, false);

    node.setHovered(true);
    assert.equal(node.hovered, true);
  });

  it('管线能力：只有流动状态（开关 / 速度 / 相位），不参与选中', () => {
    const flow = new FlowGraphic({ id: 1, width: 10, height: 10, animationSpeed: 2 });
    assert.equal(flow.open, true, '默认打开');
    assert.equal(flow.animated, true);
    assert.equal(flow.currentAnimationSpeed, 2);
    assert.equal('selected' in flow, false, '管线没有选中能力');

    flow.setOpen(false);
    assert.equal(flow.animated, false);
    assert.equal(flow.currentAnimationSpeed, 0, '关闭时不流动');

    flow.toggleOpen();
    assert.equal(flow.open, true, '实例化装配：关闭决定不动，重开恢复');

    flow.advanceFlow(12.5);
    assert.equal(flow.flowOffset, 12.5);
    assert.equal(flow.toInstance().selected, 0, '管线实例的选中通道恒为 0');
  });

  it('自定义数据：默认 null，可挂可换，且不参与绘制', () => {
    const g = new DataGraphic<{ tag: string }>({ id: 1, width: 20, height: 10 });
    assert.equal(g.data, null, '默认没有用户数据');
    assert.equal(g.toInstance().sx, 20, '没数据也照常打包');

    g.clearDirty();
    g.setData({ tag: 'P-101' });
    assert.deepEqual(g.data, { tag: 'P-101' });
    assert.equal(g.dirty, false, '数据变更不触发重绘');
    assert.deepEqual(g.toInstance().colorA, 0, '数据不进实例通道');

    const withData = new DataGraphic({ id: 2, data: { tag: 'x' } });
    assert.deepEqual(withData.data, { tag: 'x' }, '也可以从构造参数带上');

    // 绘制层不带数据：Graphic 上没有 data/setData
    assert.equal('data' in new Graphic({ id: 3 }), false, 'Graphic 只管怎么画');
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

describe('分层：基础 → 绘制 → 数据 → 两种能力', () => {
  it('属性按层归位：基础只有身份/变换，绘制加外观形状，data 再上一层，能力层各加一种', () => {
    const base = new GraphicBase({ id: 1, x: 1, y: 2, width: 3, height: 4 });
    // 基础层自己就能算包围盒、能进四叉树、能当实例变换的来源
    assert.deepEqual(round(base.worldAABB), { minX: -0.5, minY: 0, maxX: 2.5, maxY: 4 });
    assert.equal(base.tx, 1);
    // 但基础层不认识外观/形状/打包，也没有选中与流动
    assert.equal('fillColor' in base, false, '基础层不带外观');
    assert.equal('shape' in base, false, '基础层不带形状');
    assert.equal('toInstance' in base, false, '基础层不参与打包');
    assert.equal('selected' in base, false, '基础层不带选中');
    assert.equal('open' in base, false, '基础层不带流动');

    const graphic = new Graphic({ id: 2, x: 0, y: 0 }).rect(10, 10).fill(RED);
    assert.ok(graphic instanceof GraphicBase, 'Graphic 继承基础层');
    assert.equal('data' in graphic, false, '绘制层不带用户数据');
    assert.equal('selected' in graphic, false, '绘制层不带选中');
    assert.equal('open' in graphic, false, '绘制层不带流动');

    const withData = new DataGraphic({ id: 3, data: { tag: 'x' } });
    assert.ok(withData instanceof Graphic, 'DataGraphic 继承绘制层');
    assert.deepEqual(withData.data, { tag: 'x' });

    // 两种能力都长在 DataGraphic 上，但彼此独立
    const shape = new SelectableGraphic({ id: 4 });
    assert.ok(shape instanceof DataGraphic, '图形能力继承数据层');
    assert.equal('open' in shape, false, '图形没有流动');

    const pipe = new FlowGraphic({ id: 5 });
    assert.ok(pipe instanceof DataGraphic, '管线能力继承数据层');
    assert.equal('selected' in pipe, false, '管线没有选中');
  });
});

describe('外观 → 实例数据', () => {
  it('打包实例：屏幕像素尺寸按缩放折算，uv 与颜色透传，没颜色就是不画', () => {
    const sprite = new Graphic({ id: 9, x: 10, y: 20 })
      .screenSize(40, 24)
      .atlasUv([0.25, 0, 0.5, 1])
      .fill([1, 1, 1, 1]);

    const instance = sprite.toInstance(0.5);
    assert.equal(instance.sx, 80, '40 屏幕像素 ÷ 0.5 = 80 世界单位');
    assert.equal(instance.sy, 48);
    assert.deepEqual([instance.u0, instance.u1], [0.25, 0.5]);
    assert.equal(instance.colorA, 1);

    const plain = new Graphic({ id: 10, width: 10, height: 10 });
    assert.equal(plain.sizeUnit, 'world', '默认世界尺寸口径');
    assert.equal(plain.toInstance().sx, 10, '世界尺寸不折算缩放');
    assert.equal(plain.toInstance().colorA, 0, '没指定颜色 → 渲染与拾取都当它不存在');
  });

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
