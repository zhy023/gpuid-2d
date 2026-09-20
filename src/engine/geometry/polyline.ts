interface Point {
  x: number;
  y: number;
}

/**向量归一化 */
function normalize(dx: number, dy: number): Point {
  const len = Math.hypot(dx, dy);
  if (len < 1e-9) return { x: 0, y: 0 };
  return { x: dx / len, y: dy / len };
}

export interface ExpandResult {
  vertexData: Float32Array;
  totalLength: number; // 管线总长度，用于uv计算
}

/**
 * 宽折线膨胀，输出 x,y,u,v 交错数组
 * @param points 折点
 * @param lineWidth 管线宽度
 */
export function expandPolyline(points: Point[], lineWidth: number): ExpandResult {
  if (points.length < 2) {
    return { vertexData: new Float32Array(), totalLength: 0 };
  }
  const halfW = lineWidth / 2;
  const out: number[] = [];
  let accumulatedLen = 0;
  const segLengths: number[] = [];

  // 预计算每一段长度
  for (let i = 1; i < points.length; i++) {
    const dx = points[i].x - points[i - 1].x;
    const dy = points[i].y - points[i - 1].y;
    const l = Math.hypot(dx, dy);
    segLengths.push(l);
    accumulatedLen += l;
  }

  function getNormal(p0: Point, p1: Point): Point {
    const dx = p1.x - p0.x;
    const dy = p1.y - p0.y;
    const n = normalize(dx, dy);
    return { x: -n.y * halfW, y: n.x * halfW };
  }

  // 起点
  const n0 = getNormal(points[0], points[1]);
  out.push(points[0].x + n0.x, points[0].y + n0.y, 0.0, 1.0);
  out.push(points[0].x - n0.x, points[0].y - n0.y, 0.0, 0.0);

  let dist = 0;
  for (let i = 1; i < points.length - 1; i++) {
    dist += segLengths[i - 1];
    const u = accumulatedLen > 0 ? dist / accumulatedLen : 0;

    const prev = points[i - 1];
    const curr = points[i];
    const next = points[i + 1];

    const nPrev = getNormal(prev, curr);
    const nNext = getNormal(curr, next);

    out.push(curr.x + nPrev.x, curr.y + nPrev.y, u, 1.0);
    out.push(curr.x - nPrev.x, curr.y - nPrev.y, u, 0.0);
    out.push(curr.x + nNext.x, curr.y + nNext.y, u, 1.0);
    out.push(curr.x - nNext.x, curr.y - nNext.y, u, 0.0);
  }

  // 终点
  const lastIdx = points.length - 1;
  const nLast = getNormal(points[lastIdx - 1], points[lastIdx]);
  const endU = accumulatedLen > 0 ? 1.0 : 0;
  out.push(points[lastIdx].x + nLast.x, points[lastIdx].y + nLast.y, endU, 1.0);
  out.push(points[lastIdx].x - nLast.x, points[lastIdx].y - nLast.y, endU, 0.0);

  return {
    vertexData: new Float32Array(out),
    totalLength: accumulatedLen,
  };
}

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
