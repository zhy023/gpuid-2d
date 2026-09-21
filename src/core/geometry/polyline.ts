/**
 * 折线的几何辅助：只留点集与包围盒。
 */
export interface Point {
  x: number;
  y: number;
}

export interface OrthogonalizeOptions {
  /** 与坐标轴夹角不超过该值（弧度）的线段直接拉正，默认 5°（实测绘图员手抖都在 5° 以内） */
  toleranceRad?: number;
  /** 斜线段需要插肘点时，第一段先走水平还是先走垂直，默认水平 */
  preferHorizontalFirst?: boolean;
}

/**
 * 把折线整理成**横平竖直**（图纸里的管线按惯例只有水平和垂直段）：
 *  1. 与坐标轴夹角在容差内的线段直接拉正 —— 纠正绘图员画线时的手抖
 *  2. 仍然斜着的线段插入一个肘点，改成「先水平后垂直 / 先垂直后水平」两段
 *
 * **首末点固定不动**（它们是吸附在设备 / 连接点上的端口，动了管线就会在接头处断开）：
 * 末段用一小段肘点把方向摆正，而不是挪端点。返回新数组；重复点会被去掉。
 */
export function orthogonalizePolyline(
  points: readonly Point[],
  options: OrthogonalizeOptions = {},
): Point[] {
  if (points.length < 2) return points.map((point) => ({ ...point }));
  const tolerance = options.toleranceRad ?? (5 * Math.PI) / 180;
  const preferHorizontalFirst = options.preferHorizontalFirst ?? true;

  const out: Point[] = [{ ...points[0] }];
  const push = (point: Point): void => {
    const last = out[out.length - 1];
    if (Math.abs(last.x - point.x) < 1e-9 && Math.abs(last.y - point.y) < 1e-9) return;
    out.push(point);
  };

  for (let index = 1; index < points.length; index += 1) {
    const prev = out[out.length - 1];
    const raw = points[index];
    const dx = raw.x - prev.x;
    const dy = raw.y - prev.y;
    if (Math.abs(dx) < 1e-9 && Math.abs(dy) < 1e-9) continue;

    /**
     * 末点是端口，不能挪：按主导方向插一个肘点，让最后一段沿端口方向进出
     * （近轴段只会产生一小段摆正用的短肘，肉眼看不出来）
     */
    if (index === points.length - 1) {
      if (Math.abs(dy) <= Math.abs(dx)) push({ x: prev.x, y: raw.y });
      else push({ x: raw.x, y: prev.y });
      push({ ...raw });
      continue;
    }

    const angle = Math.atan2(Math.abs(dy), Math.abs(dx));
    if (angle <= tolerance) {
      // 近似水平 → 拉平
      push({ x: raw.x, y: prev.y });
    } else if (angle >= Math.PI / 2 - tolerance) {
      // 近似垂直 → 拉直
      push({ x: prev.x, y: raw.y });
    } else if (preferHorizontalFirst) {
      push({ x: raw.x, y: prev.y });
      push({ ...raw });
    } else {
      push({ x: prev.x, y: raw.y });
      push({ ...raw });
    }
  }

  return out;
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
