import {
  disposePipeInstances,
  renderAllVisiblePipes,
  type PipeBatchItem,
} from '@/business/pid_schematic/pipe_instances';
import { createPipeRenderResources } from '@/business/pid_schematic/pipe_pipeline';
import type { PipeRenderResources } from '@/business/pid_schematic/types';

let pipeRes: PipeRenderResources | null = null;
let gpuDevice: GPUDevice | null = null;
let pipeTemplateVertexBuffer: GPUBuffer | null = null;
let pipeTemplateVertexCount = 0;

/**
 * 管线三角带模板顶点：localPos(vec2) + flowUv(vec2)，4 顶点组成单位方块
 * flowUv.x 沿管线走向、flowUv.y 横跨管宽，与膨胀几何的 uv 约定一致
 */
function createPipeTemplateVertexBuffer(device: GPUDevice): {
  vertexBuffer: GPUBuffer;
  vertexCount: number;
} {
  const vertices = new Float32Array([
    -0.5, -0.5, 0.0, 0.0, 0.5, -0.5, 1.0, 0.0, -0.5, 0.5, 0.0, 1.0, 0.5, 0.5, 1.0, 1.0,
  ]);

  const vertexBuffer = device.createBuffer({
    size: vertices.byteLength,
    usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    label: 'pipe-template-vertex-buffer',
  });
  device.queue.writeBuffer(vertexBuffer, 0, vertices);

  return { vertexBuffer, vertexCount: 4 };
}

/**
 * 初始化管线模块
 * @param device GPUDevice
 * @param canvasFormat 画布格式
 */
export async function initPipe(device: GPUDevice, canvasFormat: GPUTextureFormat) {
  const template = createPipeTemplateVertexBuffer(device);

  gpuDevice = device;
  pipeTemplateVertexBuffer = template.vertexBuffer;
  pipeTemplateVertexCount = template.vertexCount;
  pipeRes = await createPipeRenderResources(device, canvasFormat);
}

/**
 * 主渲染入口，渲染循环调用
 * @param pixelsPerWorldUnit 当前相机缩放，用于把管线像素粗细折算成世界宽度
 */
export function renderPipes(
  passEncoder: GPURenderPassEncoder,
  viewProj: Float32Array,
  visibleItems: readonly PipeBatchItem[],
  pixelsPerWorldUnit: number,
): void {
  if (!pipeRes || !gpuDevice || !pipeTemplateVertexBuffer) return;

  const timeSec = performance.now() / 1000;
  renderAllVisiblePipes(
    passEncoder,
    gpuDevice,
    pipeRes,
    viewProj,
    timeSec,
    visibleItems,
    pipeTemplateVertexBuffer,
    pipeTemplateVertexCount,
    pixelsPerWorldUnit,
  );
}

export function getPipeResources(): PipeRenderResources | null {
  return pipeRes;
}

/** 释放管线模块：销毁 GPU 资源并清空模块状态，可重新初始化 */
export function disposePipes(): void {
  disposePipeInstances();
  pipeRes = null;
  gpuDevice = null;
  pipeTemplateVertexBuffer = null;
  pipeTemplateVertexCount = 0;
}
