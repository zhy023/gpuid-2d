/**
 * 几何体：矩形顶点数据，顶点buffer
 */

export function createRectVertexBuffer(device: GPUDevice) {
  // 矩形6个顶点
  const vertices = new Float32Array([
    -0.5, -0.5, 0.5, -0.5, -0.5, 0.5, -0.5, 0.5, 0.5, -0.5, 0.5, 0.5,
  ]);

  const vertexBuffer = device.createBuffer({
    size: vertices.byteLength,
    usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(vertexBuffer, 0, vertices);

  return { vertexBuffer, vertexCount: 6 };
}
