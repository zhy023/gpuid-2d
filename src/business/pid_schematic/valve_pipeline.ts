/**
 * 设备图元（阀门符号）的 GPU 资源：
 * binding0 正交投影 UBO / binding1 InstanceTransform / binding2 P&ID 业务数据
 *
 * 主渲染与拾取两条 pipeline 共用同一套绑定，因此一份 bindGroup 可以同时用于两者。
 */
import valvePickWgsl from '@/business/pid_schematic/shader/generated/valve_pick';
import valveWgsl from '@/business/pid_schematic/shader/generated/valve_render';
import type { ValveRenderResources } from '@/business/pid_schematic/types';
import { ALPHA_BLEND_STATE, CANVAS_SAMPLE_COUNT } from '@/core/gpu/render_state';

/** 与 WGSL OrthoProjectionUniform 对齐，留出后续设备动画参数的余量 */
const UNIFORM_BUFFER_SIZE = 256;

/**
 * 创建设备图元 pipeline + pickPipeline
 * @param device GPUDevice
 * @param canvasFormat 画布纹理格式
 * @param vertexBufferLayout 符号模板顶点布局（与核心侧矩形模板一致）
 */
export async function createValveRenderResources(
  device: GPUDevice,
  canvasFormat: GPUTextureFormat,
  vertexBufferLayout: GPUVertexBufferLayout,
): Promise<ValveRenderResources> {
  const uniformBuffer = device.createBuffer({
    size: UNIFORM_BUFFER_SIZE,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    label: 'valve-uniform-buffer',
  });

  const shaderModule = device.createShaderModule({ code: valveWgsl });
  const pickShaderModule = device.createShaderModule({ code: valvePickWgsl });

  const bindGroupLayout = device.createBindGroupLayout({
    entries: [
      {
        binding: 0,
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
        visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
        buffer: { type: 'read-only-storage' },
      },
    ],
    label: 'valve-bind-group-layout',
  });
  const pipelineLayout = device.createPipelineLayout({
    bindGroupLayouts: [bindGroupLayout],
  });

  const pipeline = await device.createRenderPipelineAsync({
    layout: pipelineLayout,
    vertex: {
      module: shaderModule,
      entryPoint: 'vertexMain',
      buffers: [vertexBufferLayout],
    },
    fragment: {
      module: shaderModule,
      entryPoint: 'fragmentMain',
      targets: [{ format: canvasFormat, blend: ALPHA_BLEND_STATE }],
    },
    primitive: { topology: 'triangle-list' },
    // 与画布 MSAA 目标一致，否则同一个 pass 内校验不过
    multisample: { count: CANVAS_SAMPLE_COUNT },
  });

  // 拾取 pipeline：阀门拾取着色器用 vertex_index 自己生成 quad，无外部顶点输入
  const pickPipeline = await device.createRenderPipelineAsync({
    layout: pipelineLayout,
    vertex: {
      module: pickShaderModule,
      entryPoint: 'vertexMain',
      buffers: [],
    },
    fragment: {
      module: pickShaderModule,
      entryPoint: 'fragmentMain',
      targets: [{ format: 'rgba32uint' }],
    },
    primitive: { topology: 'triangle-list' },
    depthStencil: {
      depthWriteEnabled: true,
      depthCompare: 'less',
      format: 'depth24plus',
    },
  });

  return { pipeline, pickPipeline, uniformBuffer, bindGroupLayout };
}

/**
 * 生成 bindGroup：binding1 实例变换、binding2 业务数据（阀门开关等）
 */
export function createValveBindGroup(
  device: GPUDevice,
  valveRes: ValveRenderResources,
  instanceStorageBuffer: GPUBuffer,
  businessStorageBuffer: GPUBuffer,
): GPUBindGroup {
  return device.createBindGroup({
    layout: valveRes.bindGroupLayout,
    entries: [
      { binding: 0, resource: { buffer: valveRes.uniformBuffer } },
      { binding: 1, resource: { buffer: instanceStorageBuffer } },
      { binding: 2, resource: { buffer: businessStorageBuffer } },
    ],
  });
}

/** 更新正交投影 UBO（每帧相机变化时调用） */
export function updateValveUniform(
  device: GPUDevice,
  valveRes: ValveRenderResources,
  orthoMat: Float32Array,
): void {
  const tmp = new Float32Array(UNIFORM_BUFFER_SIZE / 4);
  tmp.set(orthoMat, 0);
  device.queue.writeBuffer(valveRes.uniformBuffer, 0, tmp);
}

/**
 * 实例化绘制设备符号
 * @param vertexBuffer 符号模板顶点（核心侧矩形模板）
 */
export function drawValveInstanced(
  pass: GPURenderPassEncoder,
  valveRes: ValveRenderResources,
  bindGroup: GPUBindGroup,
  vertexBuffer: GPUBuffer,
  vertexCount: number,
  instanceCount: number,
): void {
  pass.setPipeline(valveRes.pipeline);
  pass.setBindGroup(0, bindGroup);
  pass.setVertexBuffer(0, vertexBuffer);
  pass.draw(vertexCount, instanceCount);
}

/** 拾取绘制：着色器内部 6 个顶点组成 quad */
export function drawValvePickInstanced(
  pass: GPURenderPassEncoder,
  valveRes: ValveRenderResources,
  bindGroup: GPUBindGroup,
  instanceCount: number,
): void {
  pass.setPipeline(valveRes.pickPipeline);
  pass.setBindGroup(0, bindGroup);
  pass.draw(6, instanceCount);
}
