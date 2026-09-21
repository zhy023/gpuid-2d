/**
 * 几何体：内核内置图元模板 —— **一个三角形**（不是方形）。
 *
 * 图形的局部空间仍以单位方形 `[-0.5, 0.5]` 为口径（位置 = 中心、大小 = 宽高、
 * 旋转 = 弧度），但顶点模板只提交 3 个顶点（`triangle-list`）：
 *
 * ```
 *   (-0.5,-0.5) ──────────────── (1.5,-0.5)
 *        │  ╲                        │
 *        │     ╲   单位方形          │
 *        │        ╲  [-0.5,0.5]²     │
 *        │           ╲               │
 *        │              ╲            │
 *   (-0.5, 1.5) ───────────╲─── (0.5, 0.5)
 * ```
 *
 * 斜边正好经过方形右上角，因此单位方形被完整覆盖。相比 6 顶点双三角形：
 *  - 顶点数减半（`draw(3)` 而不是 `draw(6)`），顶点着色器调用少一半
 *  - 没有共享对角线，光栅化不会在接缝处重复着色
 *
 * 代价是模板多出半个三角形的面积，方形之外的部分由着色器裁掉：
 * 覆盖度函数 `unitSquareMask`（core_include/vertex_math.wgsl）按屏幕像素做抗锯齿。
 */

/** 内置图元模板：覆盖单位方形的三角形 */
export function createTriangleVertexBuffer(device: GPUDevice): {
  vertexBuffer: GPUBuffer;
  vertexCount: number;
} {
  const vertices = new Float32Array([-0.5, -0.5, 1.5, -0.5, -0.5, 1.5]);

  const vertexBuffer = device.createBuffer({
    size: vertices.byteLength,
    usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    label: 'triangle-template-vertex-buffer',
  });
  device.queue.writeBuffer(vertexBuffer, 0, vertices);

  return { vertexBuffer, vertexCount: 3 };
}
