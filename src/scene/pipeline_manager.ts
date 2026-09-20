import { createPipeRenderResources } from '@/engine/gpu/pipeline';
import { renderAllVisiblePipes } from '@/engine/gpu/pipe_render_pass';

import type { PipeRenderResources, QuadItem } from '@/engine/types';

let pipeRes: PipeRenderResources | null = null;
let gpuDevice: GPUDevice | null = null;

/**
 * 初始化管线模块，WebGPU就绪调用一次
 */
export async function initPipe(device: GPUDevice) {
  gpuDevice = device;
  pipeRes = await createPipeRenderResources(device);
}

/**
 * 对外渲染入口，main渲染循环直接调用
 * @param passEncoder 当前renderPass
 * @param viewProj 相机viewProj矩阵 Float32Array(16)
 * @param visibleItems 四叉树查询得到的可见图元
 */
export function renderPipes(
  passEncoder: GPURenderPassEncoder,
  viewProj: Float32Array,
  visibleItems: QuadItem[],
): void {
  if (!pipeRes || !gpuDevice) return;

  const timeSec = performance.now() / 1000;
  renderAllVisiblePipes(passEncoder, gpuDevice, pipeRes, viewProj, timeSec, visibleItems);
}
