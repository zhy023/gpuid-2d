/**
 * 几何体：内核内置图元模板。
 *
 * 局部空间以单位方形 `[-0.5, 0.5]` 为口径（位置 = 中心、大小 = 宽高、旋转 = 弧度），
 * 模板本身是一个覆盖该方形的三角形：`(-0.5,-0.5) (1.5,-0.5) (-0.5,1.5)`，斜边经过
 * 右上角 (0.5, 0.5)。相比 6 顶点双三角形，`draw(3)` 少一半顶点着色器调用，
 * 也没有共享对角线的接缝重复着色。
 *
 * 三角形多出的半边由着色器裁掉，见 `unitSquareMask`（core_include/vertex_math.wgsl）。
 */
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
