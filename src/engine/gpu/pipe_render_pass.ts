import type { PipePolylineItem, PipeRenderResources, QuadItem } from '@/engine/types';

/**
 * 对外唯一入口：渲染全部可见管线
 * @param passEncoder
 * @param device
 * @param pipeRes
 * @param viewProj 相机矩阵 Float32Array(16)
 * @param time 单位秒
 * @param visibleItems 四叉树输出可见集合
 */
export function renderAllVisiblePipes(
  passEncoder: GPURenderPassEncoder,
  device: GPUDevice,
  pipeRes: PipeRenderResources,
  viewProj: Float32Array,
  time: number,
  visibleItems: QuadItem[],
): void {
  // 更新UBO
  const tmp = new Float32Array(256 / 4);
  tmp.set(viewProj, 0);
  tmp[16] = time;
  device.queue.writeBuffer(pipeRes.uniformBuffer, 0, tmp);

  passEncoder.setPipeline(pipeRes.pipeline);
  passEncoder.setBindGroup(0, pipeRes.bindGroup);

  for (const item of visibleItems) {
    if (!('geoCache' in item)) continue;
    const pipe = item as PipePolylineItem;
    if (!pipe.geoCache) continue;
    const vertexData = pipe.geoCache.vertexData;
    if (!vertexData || vertexData.length < 4) continue;

    const vBuffer = device.createBuffer({
      size: vertexData.byteLength,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(vBuffer, 0, vertexData);

    passEncoder.setVertexBuffer(0, vBuffer);
    passEncoder.draw(vertexData.length / 4);
  }
}
