/**
 * 创建【实例化管线渲染】pipeline（管线不做拾取，所以只有主渲染一条）
 * @param device GPUDevice
 * @param canvasFormat 画布纹理格式
 */

import pipeWgsl from '@/business/pid_schematic/shader/generated/pipeline_render';
import type { PipeRenderResources } from '@/business/pid_schematic/types';
import { ALPHA_BLEND_STATE, CANVAS_SAMPLE_COUNT } from '@/core/gpu/render_state';

export async function createPipeRenderResources(
  device: GPUDevice,
  canvasFormat: GPUTextureFormat,
): Promise<PipeRenderResources> {
  const uniformBufferSize = 256;
  const uniformBuffer = device.createBuffer({
    size: uniformBufferSize,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });

  const shaderModule = device.createShaderModule({ code: pipeWgsl });

  // 显式 layout：主渲染与拾取两条 pipeline 共用同一套绑定，
  // 这样 createPipeBindGroup 生成的 bindGroup 可以同时用于两者
  const bindGroupLayout = device.createBindGroupLayout({
    entries: [
      {
        binding: 0,
        // 动画时间在 fragment 阶段参与流动条纹计算，故两个阶段都要可见
        visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
        buffer: { type: 'uniform' },
      },
      {
        binding: 1,
        visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
        buffer: { type: 'read-only-storage' },
      },
      {
        binding: 2,
        visibility: GPUShaderStage.FRAGMENT,
        buffer: { type: 'read-only-storage' },
      },
    ],
    label: 'pipe-bind-group-layout',
  });
  const pipelineLayout = device.createPipelineLayout({
    bindGroupLayouts: [bindGroupLayout],
  });

  const pipeline = await device.createRenderPipelineAsync({
    layout: pipelineLayout,
    vertex: {
      module: shaderModule,
      entryPoint: 'vertexMain',
      buffers: [
        {
          // 单条管线膨胀顶点： localPos(vec2), flowUv(vec2) → 4 * f32
          arrayStride: 4 * 4,
          attributes: [
            { shaderLocation: 0, offset: 0, format: 'float32x2' },
            { shaderLocation: 1, offset: 8, format: 'float32x2' },
          ],
        },
      ],
    },
    fragment: {
      module: shaderModule,
      entryPoint: 'fragmentMain',
      targets: [{ format: canvasFormat, blend: ALPHA_BLEND_STATE }],
    },
    primitive: {
      topology: 'triangle-strip',
    },
    // 与画布 MSAA 目标一致，否则同一个 pass 内校验不过
    multisample: { count: CANVAS_SAMPLE_COUNT },
  });

  return {
    pipeline,
    uniformBuffer,
    bindGroupLayout,
  };
}

/**
 * 根据两套StorageBuffer动态生成bindGroup
 * binding0: uniform
 * binding1: InstanceTransform[]
 * binding2: PidSchematicInstanceData[]
 */
export function createPipeBindGroup(
  device: GPUDevice,
  pipeRes: PipeRenderResources,
  instanceStorageBuffer: GPUBuffer,
  pidSchematicStorageBuffer: GPUBuffer,
): GPUBindGroup {
  return device.createBindGroup({
    layout: pipeRes.bindGroupLayout,
    entries: [
      { binding: 0, resource: { buffer: pipeRes.uniformBuffer } },
      { binding: 1, resource: { buffer: instanceStorageBuffer } },
      { binding: 2, resource: { buffer: pidSchematicStorageBuffer } },
    ],
  });
}

/**
 * 更新管线实例渲染UBO：正交矩阵 + 全局时间
 * UBO 字段顺序必须与 WGSL 的 PidPipelineAnimationUniform 一致：
 * orthoMatrix(mat3，12 个 float = 48 字节) / timeSeconds / flowPeriodWorld /
 * flowCyclesPerSec / flowDashDuty
 */
export interface PipeUniformValues {
  projection: Float32Array;
  timeSeconds: number;
  /** 一个流动周期对应的世界长度（屏幕像素周期除以相机缩放得到） */
  flowPeriodWorld: number;
  flowCyclesPerSec: number;
  flowDashDuty: number;
}

export function updatePipeUniform(
  device: GPUDevice,
  res: PipeRenderResources,
  values: PipeUniformValues,
) {
  const tmp = new Float32Array(256 / 4);
  tmp.set(values.projection, 0);
  tmp[12] = values.timeSeconds;
  tmp[13] = values.flowPeriodWorld;
  tmp[14] = values.flowCyclesPerSec;
  tmp[15] = values.flowDashDuty;
  device.queue.writeBuffer(res.uniformBuffer, 0, tmp);
}

/**
 * ✅实例模式绘制管线
 * @param pass renderPass编码器
 * @param pipeRes 管线pipeline资源
 * @param bindGroup 动态生成的bindGroup（ubo + 两套storage）
 * @param vertexBuffer 管线模板顶点（膨胀三角带）
 * @param vertexCount 单条管线顶点数量
 * @param instanceCount 需要绘制管线实例数量
 */
export function drawPipeInstanced(
  pass: GPURenderPassEncoder,
  pipeRes: PipeRenderResources,
  bindGroup: GPUBindGroup,
  vertexBuffer: GPUBuffer,
  vertexCount: number,
  instanceCount: number,
) {
  pass.setPipeline(pipeRes.pipeline);
  pass.setBindGroup(0, bindGroup);
  pass.setVertexBuffer(0, vertexBuffer);
  pass.draw(vertexCount, instanceCount);
}
