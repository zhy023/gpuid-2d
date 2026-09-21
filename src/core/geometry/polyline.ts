/**
 * 折线的几何辅助：只留点集与包围盒。
 *
 * 管线不再做 CPU 侧「带宽膨胀」（渲染按段实例化单位方块，见
 * `business/pid_schematic/pipe_instances.ts`），所以这里只有包围盒计算。
 */
export interface Point {
  x: number;
  y: number;
}

/** 折线点集的轴对齐包围盒（可选整体平移 tx / ty） */
export function calcPolylineBounds(points: Point[], tx = 0, ty = 0) {
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
