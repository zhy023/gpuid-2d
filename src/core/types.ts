/**
 * 实例化渲染契约：一个图元实例的完整 GPU 数据（16 × f32 = 64B）。
 *
 * 名字不带形状——顶点模板是「覆盖单位方形的三角形」，方框/圆/三角形都由 shape 通道
 * 在着色器里裁出来，所以这份数据既能画矩形也能画圆、三角形、贴图精灵与文字。
 */
export interface PrimitiveInstance {
  tx: number;
  ty: number;
  sx: number;
  sy: number;
  beta: number;
  selected: number; /* 0未选中，1选中 */
  /** 图集 uv 矩形 (u0,v0,u1,v1)，不贴图时填 (0,0,1,1) */
  u0: number;
  v0: number;
  u1: number;
  v1: number;
  /** 逐实例颜色 (r,g,b,a)；a <= 0.5 表示没指定颜色：该实例不绘制，也不参与拾取 */
  colorR: number;
  colorG: number;
  colorB: number;
  colorA: number;
  /**
   * 描边宽度（屏幕像素）：只有 shape = `GRAPHIC_SHAPE_RING`（描边环）的实例会用到，
   * 打包时写进 WGSL `InstanceTransform` 的第 8 个 float。
   */
  borderWidthPx?: number;
  /** 形状编码（见 `GRAPHIC_SHAPE_*`）：0 = 方框 / 1 = 圆椭圆 / 2 = 三角形；缺省方框 */
  shape?: number;
}

/** 基础AABB包围盒 */
export interface AABB {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** 2D 点（世界坐标） */
export interface Point2 {
  x: number;
  y: number;
}

/** 四叉树索引最小单元：几何/空间层只依赖 id 与世界AABB，不感知渲染字段 */
export interface QuadTreeItem {
  id: number;
  worldAABB: AABB;
}

/**
 * 实例化渲染图元的变换契约：只描述「怎么摆到 GPU 上」——位置 / 大小 / 旋转。
 *
 * 图元是矩形、管线还是阀门属于上层分类（业务彼此不同），内核不感知：
 * 内核只认一件事——用三角形模板画出来的实例。
 *
 * 选中态不在这一层：只有「图形」可选中（`SelectableGraphic`），管线没有；
 * 打包成实例时由 `Graphic#toInstance()` 写进实例的选中通道（没有选中就写 0）。
 */
export interface QuadItem extends QuadTreeItem {
  tx: number;
  ty: number;
  sx: number;
  sy: number;
  beta: number;
}
