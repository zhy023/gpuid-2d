import type { AABB } from '@/engine/types';

/**
 * 计算经过平移、缩放、旋转后的矩形世界AABB
 * @param tx 中心X
 * @param ty 中心Y
 * @param sx X方向缩放
 * @param sy Y方向缩放
 * @param beta 旋转角，弧度
 */
export function computeRotatedAABB(
  tx: number,
  ty: number,
  sx: number,
  sy: number,
  beta: number,
): AABB {
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
    minY = Infinity;
  let maxX = -Infinity,
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

/**
 * 折线点集合求AABB（用于PipePolyline管线）
 * @param points 原始点 {x,y}[]，未变换
 * @param tx 整体偏移
 * @param ty 整体偏移
 */
export function computePolylineAABB(points: Array<{ x: number; y: number }>, tx = 0, ty = 0): AABB {
  let minX = Infinity,
    minY = Infinity;
  let maxX = -Infinity,
    maxY = -Infinity;
  for (const p of points) {
    const x = p.x + tx;
    const y = p.y + ty;
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  }
  return { minX, minY, maxX, maxY };
}
