/**
 * 设备图元（阀门）模块入口：初始化、逐帧渲染、对外暴露拾取所需的绑定与 layout。
 */
import {
  disposeValveInstances,
  getValveBindGroup,
  renderVisibleValves,
} from '@/business/pid_schematic/valve_instances';
import { createValveRenderResources } from '@/business/pid_schematic/valve_pipeline';
import type { ValveItem, ValveRenderResources } from '@/business/pid_schematic/types';

let valveRes: ValveRenderResources | null = null;
let gpuDevice: GPUDevice | null = null;
let valveTemplateVertexBuffer: GPUBuffer | null = null;
let valveTemplateVertexCount = 0;

/**
 * 初始化设备图元模块
 * @param device GPUDevice
 * @param canvasFormat 画布格式
 * @param vertexLayout 符号模板顶点布局（与核心侧矩形模板一致）
 * @param templateVb 符号模板顶点 buffer
 * @param templateVCount 模板顶点数量
 */
export async function initValves(
  device: GPUDevice,
  canvasFormat: GPUTextureFormat,
  vertexLayout: GPUVertexBufferLayout,
  templateVb: GPUBuffer,
  templateVCount: number,
): Promise<void> {
  gpuDevice = device;
  valveTemplateVertexBuffer = templateVb;
  valveTemplateVertexCount = templateVCount;
  valveRes = await createValveRenderResources(device, canvasFormat, vertexLayout);
}

/** 主渲染入口：绘制可见设备图元 */
export function renderValves(
  passEncoder: GPURenderPassEncoder,
  viewProj: Float32Array,
  visibleValves: readonly ValveItem[],
  pixelsPerWorldUnit: number,
): void {
  if (!valveRes || !gpuDevice || !valveTemplateVertexBuffer) return;
  renderVisibleValves(
    passEncoder,
    gpuDevice,
    valveRes,
    viewProj,
    visibleValves,
    valveTemplateVertexBuffer,
    valveTemplateVertexCount,
    pixelsPerWorldUnit,
  );
}

/** 拾取用 bindGroup：与渲染同一份，内含当前帧上传的实例与业务数据 */
export function getValvesBindGroup(): GPUBindGroup | null {
  if (!valveRes || !gpuDevice) return null;
  return getValveBindGroup(gpuDevice, valveRes);
}

/** 拾取 pipeline 需要与渲染一致的绑定 layout */
export function getValvesBindGroupLayout(): GPUBindGroupLayout | null {
  return valveRes?.bindGroupLayout ?? null;
}

export function getValveResources(): ValveRenderResources | null {
  return valveRes;
}

/** 释放设备图元模块：销毁 GPU 资源并清空模块状态，可重新初始化 */
export function disposeValves(): void {
  disposeValveInstances();
  valveRes = null;
  gpuDevice = null;
  valveTemplateVertexBuffer = null;
  valveTemplateVertexCount = 0;
}
