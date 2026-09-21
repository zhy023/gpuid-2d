import { composeTransform2d, transformPoint2d } from '@/core/geometry/transform_2d';
import type { AABB } from '@/core/types';

/** 单位方块四角，与核心侧图元模板 [-0.5, 0.5] 一致 */
const UNIT_CORNER_X = [-0.5, 0.5, 0.5, -0.5];
const UNIT_CORNER_Y = [-0.5, -0.5, 0.5, 0.5];

/**
 * 复用缓冲
 * wgpu-matrix 的 mat3 是 12 个元素（3×4，行尾留 1 个填充）
 */
const transformMatrix = new Float64Array(12);
const cornerPoint = new Float64Array(2);

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
  /** 直接用与 GPU 一致的 T·R·S 矩阵变换单位方块四角，避免手写三角函数与着色器约定不一致 */
  const matrix = composeTransform2d(tx, ty, beta, sx, sy, transformMatrix);

  let minX = Infinity,
    minY = Infinity;
  let maxX = -Infinity,
    maxY = -Infinity;

  for (let i = 0; i < UNIT_CORNER_X.length; i += 1) {
    const world = transformPoint2d(UNIT_CORNER_X[i], UNIT_CORNER_Y[i], matrix, cornerPoint);
    minX = Math.min(minX, world[0]);
    maxX = Math.max(maxX, world[0]);
    minY = Math.min(minY, world[1]);
    maxY = Math.max(maxY, world[1]);
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

/** 按边距外扩 AABB（例如把管线像素粗细折算成世界宽度后补偿剔除视口） */
export function expandAABB(box: AABB, margin: number): AABB {
  return {
    minX: box.minX - margin,
    minY: box.minY - margin,
    maxX: box.maxX + margin,
    maxY: box.maxY + margin,
  };
}
