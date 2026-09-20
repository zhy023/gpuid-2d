import pipeWgsl from '@/engine/shader/pipe.wgsl?raw';
import type { PipeRenderResources } from '@/engine/types';

/**
 * 创建管线渲染pipeline、ubo、bindGroup
 */
export async function createPipeRenderResources(device: GPUDevice): Promise<PipeRenderResources> {
  // UBO: mat4x4f(16) + f32(4), 对齐到256字节uniform对齐要求
  const uniformBufferSize = 256;
  const uniformBuffer = device.createBuffer({
    size: uniformBufferSize,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });

  const shaderModule = device.createShaderModule({ code: pipeWgsl });

  const pipeline = await device.createRenderPipelineAsync({
    layout: 'auto',
    vertex: {
      module: shaderModule,
      entryPoint: 'vs_main',
      buffers: [
        {
          arrayStride: 4 * 4, // 4 * f32: x,y,u,v
          attributes: [
            { shaderLocation: 0, offset: 0, format: 'float32x2' }, // pos
            { shaderLocation: 1, offset: 8, format: 'float32x2' }, // uv
          ],
        },
      ],
    },
    fragment: {
      module: shaderModule,
      entryPoint: 'fs_main',
      targets: [{ format: 'bgra8unorm' }],
    },
    primitive: {
      topology: 'triangle-strip', // 修复：长破折号 → 标准短横线
    },
  });

  const bindGroup = device.createBindGroup({
    layout: pipeline.getBindGroupLayout(0),
    entries: [{ binding: 0, resource: { buffer: uniformBuffer } }],
  });

  return { pipeline, uniformBuffer, bindGroup };
}

/**
 * 更新管线UBO：viewProj矩阵 + time时间
 * @param device gpu设备
 * @param res pipe资源
 * @param viewProj 4x4矩阵 Float32Array(16)
 * @param time 秒，用于流动动画
 */
export function updatePipeUniform(
  device: GPUDevice,
  res: PipeRenderResources,
  viewProj: Float32Array,
  time: number,
) {
  const tmp = new Float32Array(256 / 4);
  tmp.set(viewProj, 0);
  tmp[16] = time;
  device.queue.writeBuffer(res.uniformBuffer, 0, tmp);
}

/**
 * 绘制一条管线【调试版本】
 * ⚠️ 每次新建VertexBuffer，不适合上千条管线场景，会内存上涨，仅功能调试
 * @param passEncoder renderPass
 * @param device
 * @param pipeRes
 * @param vertexData x,y,u,v 交错 Float32Array
 */
export function drawSinglePipe(
  passEncoder: GPURenderPassEncoder,
  device: GPUDevice,
  pipeRes: PipeRenderResources,
  vertexData: Float32Array,
) {
  if (vertexData.length < 4) return;

  const vBuffer = device.createBuffer({
    size: vertexData.byteLength,
    usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(vBuffer, 0, vertexData);

  passEncoder.setPipeline(pipeRes.pipeline);
  passEncoder.setBindGroup(0, pipeRes.bindGroup);
  passEncoder.setVertexBuffer(0, vBuffer);
  passEncoder.draw(vertexData.length / 4);

  // 调试提示：buffer无法同步销毁，交给GC回收；正式项目改用顶点池
}
