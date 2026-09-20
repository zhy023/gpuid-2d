import type { PipePolylineItem, AABB } from '@/engine/types';
import { expandPolyline, calcPolylineBounds } from '@/engine/geometry/polyline';

/**
 * 更新管线几何缓存
 * points / lineWidth 修改后设置dirty=true，调用这个函数生成顶点
 */
export function rebuildPipeGeometry(pipe: PipePolylineItem): void {
  const res = expandPolyline(pipe.points, pipe.lineWidth);
  pipe.geoCache = res;
}

/**
 * 计算管线AABB，用于四叉树插入/更新
 */
export function computePipeAABB(pipe: PipePolylineItem): AABB {
  return calcPolylineBounds(pipe.points);
}

/**
 * 创建管线示例对象
 */
export function createPipeItem(
  id: number,
  points: Array<{ x: number; y: number }>,
  lineWidth = 12,
): PipePolylineItem {
  const worldAABB = computePipeAABB({
    id,
    dirty: true,
    points,
    lineWidth,
    geoCache: null,
    flowSpeed: 1.0,
    worldAABB: { minX: 0, minY: 0, maxX: 0, maxY: 0 },
  });
  return {
    id,
    dirty: true,
    points,
    lineWidth,
    geoCache: null,
    flowSpeed: 1.0,
    worldAABB,
  };
}
