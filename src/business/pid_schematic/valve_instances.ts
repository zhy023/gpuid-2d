/**
 * 设备图元（阀门符号）实例打包与绘制通路。
 * binding1 放实例变换（与核心侧 InstanceTransform 一致），binding2 放业务数据（阀门开关）。
 */
import {
  createValveBindGroup,
  drawValveInstanced,
  updateValveUniform,
} from '@/business/pid_schematic/valve_pipeline';
import { minDeviceSymbolWorldSize } from '@/business/pid_schematic/device_style';
import type { ValveItem, ValveRenderResources } from '@/business/pid_schematic/types';
import { spriteInstance } from '@/core/geometry/instance_sprite';
import type { RectInstance } from '@/core/types';

// 设备符号数量上限，压测可按需调大
const MAX_VALVE_INSTANCE = 4096;
// InstanceTransform：8 个基字段 + 图集 uv 矩形(4) → 12 × f32 = 48B，与 WGSL 结构一致
const INSTANCE_FLOAT_COUNT = 16;
// PidSchematicInstanceData：valveOpen, flowSpeed, flowOffset, pad = 4 float
const BUSINESS_FLOAT_COUNT = 4;

// CPU 侧复用数组，避免每帧 new
const instanceCpuBuffer = new Float32Array(MAX_VALVE_INSTANCE * INSTANCE_FLOAT_COUNT);
const businessCpuBuffer = new Float32Array(MAX_VALVE_INSTANCE * BUSINESS_FLOAT_COUNT);

let valveInstanceStorageBuffer: GPUBuffer | null = null;
let valveBusinessStorageBuffer: GPUBuffer | null = null;
// buffer 与 layout 固定，bindGroup 只需建一次
let valveBindGroup: GPUBindGroup | null = null;

/** 初始化两套 StorageBuffer，仅执行一次 */
function ensureValveStorage(device: GPUDevice): void {
  if (valveInstanceStorageBuffer && valveBusinessStorageBuffer) return;

  valveInstanceStorageBuffer = device.createBuffer({
    size: MAX_VALVE_INSTANCE * INSTANCE_FLOAT_COUNT * 4,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    label: 'valve-instance-storage-buffer',
  });
  valveBusinessStorageBuffer = device.createBuffer({
    size: MAX_VALVE_INSTANCE * BUSINESS_FLOAT_COUNT * 4,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    label: 'valve-business-storage-buffer',
  });
}

/** 取两套 storage buffer（首次调用时创建），未就绪返回 null */
function getValveStorage(
  device: GPUDevice,
): { instanceBuffer: GPUBuffer; businessBuffer: GPUBuffer } | null {
  ensureValveStorage(device);

  const instanceBuffer = valveInstanceStorageBuffer;
  const businessBuffer = valveBusinessStorageBuffer;
  if (!instanceBuffer || !businessBuffer) return null;
  return { instanceBuffer, businessBuffer };
}

/** 取缓存 bindGroup（拾取通路复用同一份） */
export function getValveBindGroup(
  device: GPUDevice,
  valveRes: ValveRenderResources,
): GPUBindGroup | null {
  const storage = getValveStorage(device);
  if (!storage) return null;

  valveBindGroup ??= createValveBindGroup(
    device,
    valveRes,
    storage.instanceBuffer,
    storage.businessBuffer,
  );
  return valveBindGroup;
}

/** 释放设备图元侧两套 StorageBuffer 与缓存绑定；调用后模块可重新初始化 */
export function disposeValveInstances(): void {
  valveInstanceStorageBuffer?.destroy();
  valveBusinessStorageBuffer?.destroy();
  valveInstanceStorageBuffer = null;
  valveBusinessStorageBuffer = null;
  valveBindGroup = null;
}

/**
 * 构建阀门精灵实例：按开关态分成两组（关闭 / 开启），
 * 便于绘制时分别绑定 `famen_off` / `famen_on` 两张贴图（同一实例缓冲，只是换纹理）。
 *
 * 尺寸口径：贴图按 @2x 的一半落地，屏幕尺寸与相机缩放无关。
 * 这属于业务表现（用哪张图、多大），所以放业务层；像素↔世界的换算用核心的 spriteInstance。
 */
export function buildValveSpriteInstances(
  valves: readonly ValveItem[],
  options: { textureWidth: number; textureHeight: number; pixelsPerWorldUnit: number },
): { closed: RectInstance[]; open: RectInstance[] } {
  const { textureWidth, textureHeight, pixelsPerWorldUnit } = options;
  const widthPx = textureWidth / 2;
  const heightPx = textureHeight / 2;
  const closed: RectInstance[] = [];
  const open: RectInstance[] = [];

  for (const valve of valves) {
    const instance = spriteInstance({
      tx: valve.tx,
      ty: valve.ty,
      widthPx,
      heightPx,
      pixelsPerWorldUnit,
    });
    if (valve.valveOpen > 0.5) open.push(instance);
    else closed.push(instance);
  }

  return { closed, open };
}

/**
 * 打包可见设备图元 → 两套 CPU 数组
 * @returns 有效实例个数
 */
function packValveInstances(valves: readonly ValveItem[], pixelsPerWorldUnit: number): number {
  let writeIdx = 0;
  // 符号最小 4×4 像素：低于下限时按世界单位撑大
  const minSymbolWorld = minDeviceSymbolWorldSize(pixelsPerWorldUnit);

  for (const valve of valves) {
    if (writeIdx >= MAX_VALVE_INSTANCE) break;
    if (valve.type !== 'valve') continue;

    const instanceOffset = writeIdx * INSTANCE_FLOAT_COUNT;
    instanceCpuBuffer[instanceOffset + 0] = Math.max(valve.sx, minSymbolWorld);
    instanceCpuBuffer[instanceOffset + 1] = Math.max(valve.sy, minSymbolWorld);
    instanceCpuBuffer[instanceOffset + 2] = valve.beta;
    instanceCpuBuffer[instanceOffset + 3] = valve.tx;
    instanceCpuBuffer[instanceOffset + 4] = valve.ty;
    instanceCpuBuffer[instanceOffset + 5] = valve.selected;
    instanceCpuBuffer[instanceOffset + 6] = 0;
    instanceCpuBuffer[instanceOffset + 7] = 0;
    // 图集 uv：设备符号暂不贴图，整张纹理
    instanceCpuBuffer[instanceOffset + 8] = 0;
    instanceCpuBuffer[instanceOffset + 9] = 0;
    instanceCpuBuffer[instanceOffset + 10] = 1;
    instanceCpuBuffer[instanceOffset + 11] = 1;
    // 逐实例颜色：默认 0（沿用着色器默认色）
    instanceCpuBuffer[instanceOffset + 12] = 0;
    instanceCpuBuffer[instanceOffset + 13] = 0;
    instanceCpuBuffer[instanceOffset + 14] = 0;
    instanceCpuBuffer[instanceOffset + 15] = 0;

    const businessOffset = writeIdx * BUSINESS_FLOAT_COUNT;
    businessCpuBuffer[businessOffset + 0] = valve.valveOpen > 0.5 ? 1 : 0;
    businessCpuBuffer[businessOffset + 1] = 0;
    businessCpuBuffer[businessOffset + 2] = 0;
    businessCpuBuffer[businessOffset + 3] = 0;

    writeIdx += 1;
  }

  return writeIdx;
}

/**
 * 渲染可见设备图元（阀门符号）
 * @param viewProj 相机正交矩阵
 * @param visibleValves 视口剔除后的设备图元，顺序即实例下标（拾取按同一顺序解读）
 * @param vertexBuffer 符号模板顶点（核心侧矩形模板）
 */
export function renderVisibleValves(
  pass: GPURenderPassEncoder,
  device: GPUDevice,
  valveRes: ValveRenderResources,
  viewProj: Float32Array,
  visibleValves: readonly ValveItem[],
  vertexBuffer: GPUBuffer,
  vertexCount: number,
  pixelsPerWorldUnit: number,
): void {
  const storage = getValveStorage(device);
  if (!storage) return;

  const instanceCount = packValveInstances(visibleValves, pixelsPerWorldUnit);
  if (instanceCount <= 0) return;

  device.queue.writeBuffer(
    storage.instanceBuffer,
    0,
    instanceCpuBuffer,
    0,
    instanceCount * INSTANCE_FLOAT_COUNT,
  );
  device.queue.writeBuffer(
    storage.businessBuffer,
    0,
    businessCpuBuffer,
    0,
    instanceCount * BUSINESS_FLOAT_COUNT,
  );
  updateValveUniform(device, valveRes, viewProj);

  const bindGroup = getValveBindGroup(device, valveRes);
  if (!bindGroup) return;

  drawValveInstanced(pass, valveRes, bindGroup, vertexBuffer, vertexCount, instanceCount);
}

/**
 * 只上传阀门实例数据 + 投影 UBO，不做绘制。
 * 阀门显示改走核心实例批次（贴图精灵）后，拾取通路仍然依赖这两套 storage buffer
 * 与最新投影矩阵，所以每帧依旧要调用它。
 */
export function uploadValveInstances(
  device: GPUDevice,
  valveRes: ValveRenderResources,
  viewProj: Float32Array,
  visibleValves: readonly ValveItem[],
  pixelsPerWorldUnit: number,
): void {
  const storage = getValveStorage(device);
  if (!storage) return;

  const instanceCount = packValveInstances(visibleValves, pixelsPerWorldUnit);
  if (instanceCount <= 0) return;

  device.queue.writeBuffer(
    storage.instanceBuffer,
    0,
    instanceCpuBuffer,
    0,
    instanceCount * INSTANCE_FLOAT_COUNT,
  );
  device.queue.writeBuffer(
    storage.businessBuffer,
    0,
    businessCpuBuffer,
    0,
    instanceCount * BUSINESS_FLOAT_COUNT,
  );
  updateValveUniform(device, valveRes, viewProj);
}
