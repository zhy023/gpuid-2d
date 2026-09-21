export interface RectInstance {
  tx: number;
  ty: number;
  sx: number;
  sy: number;
  beta: number;
  selected: number; // 0未选中，1选中
  /** 图集 uv 矩形 (u0,v0,u1,v1)，不贴图时填 (0,0,1,1) */
  u0: number;
  v0: number;
  u1: number;
  v1: number;
  /** 逐实例颜色 (r,g,b,a)；a = 0 表示沿用着色器默认颜色 */
  colorR: number;
  colorG: number;
  colorB: number;
  colorA: number;
  /** 形状编码（见 `GRAPHIC_SHAPE_*`）：0 = 方框，1 = 圆/椭圆；缺省方框 */
  shape?: number;
}

// 基础AABB包围盒
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

// 四叉树索引最小单元：几何/空间层只依赖 id 与世界AABB，不感知渲染字段
export interface QuadTreeItem {
  id: number;
  worldAABB: AABB;
}

/**
 * 实例化渲染图元：字段顺序与 WGSL `InstanceTransform` 严格一致（8 × f32 = 32B）
 * scaleX, scaleY, rotateRad, worldPositionX, worldPositionY, isSelected, pad0, pad1
 */
export interface QuadItem extends QuadTreeItem {
  type: 'rect' | 'pipeline' | 'valve';
  tx: number;
  ty: number;
  sx: number;
  sy: number;
  beta: number;
  /** 选中态：模型层用布尔，打包成实例时才映射成 float（着色器按 > 0.5 判定） */
  selected: boolean;
}
