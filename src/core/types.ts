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
}

// 基础AABB包围盒
export interface AABB {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
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
  selected: number; // 0未选中，1选中
}
