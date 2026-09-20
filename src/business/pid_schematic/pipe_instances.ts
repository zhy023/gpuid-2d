import {
  createPipeBindGroup,
  drawPipeInstanced,
  drawPipePickInstanced,
  updatePipeUniform,
} from '@/business/pid_schematic/pipe_pipeline';
import {
  PIPE_FLOW_CYCLES_PER_SEC,
  PIPE_FLOW_DASH_DUTY,
  PIPE_FLOW_PERIOD_PX,
  pipeLineWidthToWorld,
} from '@/business/pid_schematic/pipe_style';
import type { PipePolylineItem, PipeRenderResources } from '@/business/pid_schematic/types';
import type { QuadItem } from '@/core/types';

// 最大管线实例数量，压测可按需调大（管线按段展开，直角拐点还要各加一个方块实例）
const MAX_PIPE_INSTANCE = 8192;
// InstanceTransform：8 个基字段 + 图集 uv 矩形(4) → 12 × f32 = 48B，与 WGSL 结构一致
const INSTANCE_FLOAT_COUNT = 16;
// PidSchematicInstanceData：valveOpen, flowSpeed, flowOffset, pad = 4 float
const PID_DATA_FLOAT_COUNT = 4;

/** 阀门图元：在通用 QuadItem 之上携带阀门开关状态 */
interface ValveQuadItem extends QuadItem {
  valveOpen: number;
}

// CPU侧复用数组，避免每帧new
const instanceCpuBuffer = new Float32Array(MAX_PIPE_INSTANCE * INSTANCE_FLOAT_COUNT);
const pidDataCpuBuffer = new Float32Array(MAX_PIPE_INSTANCE * PID_DATA_FLOAT_COUNT);

let pipeInstanceStorageBuffer: GPUBuffer | null = null;
let pipePidStorageBuffer: GPUBuffer | null = null;
// 两套 storage buffer 一旦创建就不再变更，bindGroup 可以缓存复用，避免每帧重建
let pipeBindGroup: GPUBindGroup | null = null;

/**
 * 初始化两套StorageBuffer，仅执行一次
 * binding1: InstanceTransform
 * binding2: PidSchematicInstanceData
 */
function ensurePipeInstanceStorage(device: GPUDevice) {
  if (pipeInstanceStorageBuffer && pipePidStorageBuffer) return;

  const transformByteSize = MAX_PIPE_INSTANCE * INSTANCE_FLOAT_COUNT * 4;
  pipeInstanceStorageBuffer = device.createBuffer({
    size: transformByteSize,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    label: 'pipe‑instance‑storage‑buffer',
  });

  const pidByteSize = MAX_PIPE_INSTANCE * PID_DATA_FLOAT_COUNT * 4;
  pipePidStorageBuffer = device.createBuffer({
    size: pidByteSize,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    label: 'pipe‑pid‑storage‑buffer',
  });
}

/** 取两套 storage buffer（首次调用时创建），未就绪返回 null */
function getPipeStorageBuffers(
  device: GPUDevice,
): { instanceBuffer: GPUBuffer; pidBuffer: GPUBuffer } | null {
  ensurePipeInstanceStorage(device);

  const instanceBuffer = pipeInstanceStorageBuffer;
  const pidBuffer = pipePidStorageBuffer;
  if (!instanceBuffer || !pidBuffer) return null;
  return { instanceBuffer, pidBuffer };
}

/** 缓存 bindGroup：buffer 与 layout 都固定，只需创建一次 */
function getPipeBindGroup(device: GPUDevice, pipeRes: PipeRenderResources): GPUBindGroup | null {
  const storage = getPipeStorageBuffers(device);
  if (!storage) return null;

  pipeBindGroup ??= createPipeBindGroup(device, pipeRes, storage.instanceBuffer, storage.pidBuffer);
  return pipeBindGroup;
}

/** 释放管线侧两套 StorageBuffer 与缓存绑定；调用后模块可重新初始化 */
export function disposePipeInstances(): void {
  pipeInstanceStorageBuffer?.destroy();
  pipePidStorageBuffer?.destroy();
  pipeInstanceStorageBuffer = null;
  pipePidStorageBuffer = null;
  pipeBindGroup = null;
}

/** 写入单个实例的 InstanceTransform（8 × f32，字段顺序对齐 WGSL 结构体） */
function writeInstanceTransform(
  writeIdx: number,
  sx: number,
  sy: number,
  beta: number,
  tx: number,
  ty: number,
  selected: number,
): void {
  const offset = writeIdx * INSTANCE_FLOAT_COUNT;
  instanceCpuBuffer[offset + 0] = sx;
  instanceCpuBuffer[offset + 1] = sy;
  instanceCpuBuffer[offset + 2] = beta;
  instanceCpuBuffer[offset + 3] = tx;
  instanceCpuBuffer[offset + 4] = ty;
  instanceCpuBuffer[offset + 5] = selected;
  instanceCpuBuffer[offset + 6] = 0;
  instanceCpuBuffer[offset + 7] = 0;
  // 图集 uv：管线暂不贴图，整张纹理
  instanceCpuBuffer[offset + 8] = 0;
  instanceCpuBuffer[offset + 9] = 0;
  instanceCpuBuffer[offset + 10] = 1;
  instanceCpuBuffer[offset + 11] = 1;
  // 逐实例颜色：默认 0（沿用着色器默认色）
  instanceCpuBuffer[offset + 12] = 0;
  instanceCpuBuffer[offset + 13] = 0;
  instanceCpuBuffer[offset + 14] = 0;
  instanceCpuBuffer[offset + 15] = 0;
}

/** 写入单个实例的 PidSchematicInstanceData（4 × f32） */
function writePidInstanceData(
  writeIdx: number,
  valveOpen: number,
  flowSpeed: number,
  flowOffset: number,
): void {
  const offset = writeIdx * PID_DATA_FLOAT_COUNT;
  pidDataCpuBuffer[offset + 0] = valveOpen;
  pidDataCpuBuffer[offset + 1] = flowSpeed;
  pidDataCpuBuffer[offset + 2] = flowOffset;
  pidDataCpuBuffer[offset + 3] = 0;
}

/**
 * 过滤并打包管线/阀门 QuadItem → 两套CPU数组。
 *
 * 管线按「每段一个实例」展开：单位方块模板经 平移(段中点) × 旋转(段方向角) × 缩放(段长, 管宽)
 * 正好铺满该段，因此多段折线不需要为每条管线单独建顶点 buffer。
 * 管宽按当前相机缩放折算成世界宽度，保证屏幕上的粗细恒定（像素单位）。
 * @param pixelsPerWorldUnit 当前相机缩放（1 世界单位对应多少屏幕像素）
 * @returns 有效实例个数（管线条数按段数展开后的总数）
 */
function packPipeInstanceItems(
  visibleItems: readonly QuadItem[],
  pixelsPerWorldUnit: number,
): number {
  let writeIdx = 0;

  for (const item of visibleItems) {
    if (writeIdx >= MAX_PIPE_INSTANCE) break;
    // pipeline + valve 都打进实例数组
    if (item.type !== 'pipeline' && item.type !== 'valve') continue;

    if (item.type === 'valve') {
      writeInstanceTransform(
        writeIdx,
        item.sx,
        item.sy,
        item.beta,
        item.tx,
        item.ty,
        item.selected,
      );
      // 阀门：valveOpen 有效，流速置 0（阀门本身不做流动动画）
      writePidInstanceData(writeIdx, (item as ValveQuadItem).valveOpen ?? 1.0, 0, 0);
      writeIdx += 1;
      continue;
    }

    const pipe = item as PipePolylineItem;
    const flowSpeed = pipe.flowSpeed ?? 1.0;
    // 屏幕像素粗细 → 世界宽度，逐帧跟随缩放
    const lineWidthWorld = pipeLineWidthToWorld(pipe.lineWidthPx, pixelsPerWorldUnit);
    // 以管宽为单位的累计里程，喂给 flowOffset，保证拐点两侧条纹相位接得上
    let travelled = 0;

    for (
      let pointIdx = 1;
      pointIdx < pipe.points.length && writeIdx < MAX_PIPE_INSTANCE;
      pointIdx += 1
    ) {
      const start = pipe.points[pointIdx - 1];
      const end = pipe.points[pointIdx];
      const dx = end.x - start.x;
      const dy = end.y - start.y;
      const segmentLength = Math.hypot(dx, dy);
      if (segmentLength < 1e-6) continue;

      writeInstanceTransform(
        writeIdx,
        segmentLength,
        lineWidthWorld,
        Math.atan2(dy, dx),
        (start.x + end.x) / 2,
        (start.y + end.y) / 2,
        item.selected,
      );
      // flowOffset 用世界里程，保证条纹沿整条管线连续
      writePidInstanceData(writeIdx, 0, flowSpeed, travelled);

      travelled += segmentLength;
      writeIdx += 1;

      // 直角拐点补一个「管宽 × 管宽」方块：两段都是平头结束，
      // 没有它右边角的缺口会露出背景（管越粗越明显）
      const isJoint = pointIdx < pipe.points.length - 1;
      if (isJoint && writeIdx < MAX_PIPE_INSTANCE) {
        writeInstanceTransform(
          writeIdx,
          lineWidthWorld,
          lineWidthWorld,
          0,
          end.x,
          end.y,
          item.selected,
        );
        writePidInstanceData(writeIdx, 0, flowSpeed, travelled);
        writeIdx += 1;
      }
    }
  }

  return writeIdx;
}

/**
 * 【主渲染通路】渲染可见管线，带流动动画、选中高亮
 * @param pass 主渲染RenderPass
 * @param device gpu设备
 * @param pipeRes 管线资源
 * @param viewProj 相机正交矩阵 Float32Array(16)
 * @param timeSec 时间秒，用于流动动画
 * @param visibleItems 四叉树返回全部可见图元
 * @param pipeTemplateVb 管线三角带模板顶点buffer
 * @param templateVertexCount 模板顶点数量
 * @param pixelsPerWorldUnit 当前相机缩放，用于把管线像素粗细折算成世界宽度
 */
export function renderAllVisiblePipes(
  pass: GPURenderPassEncoder,
  device: GPUDevice,
  pipeRes: PipeRenderResources,
  viewProj: Float32Array,
  timeSec: number,
  visibleItems: readonly QuadItem[],
  pipeTemplateVb: GPUBuffer,
  templateVertexCount: number,
  pixelsPerWorldUnit: number,
): void {
  const storage = getPipeStorageBuffers(device);
  if (!storage) return;

  const validCount = packPipeInstanceItems(visibleItems, pixelsPerWorldUnit);
  if (validCount <= 0) return;

  // 写两套storage buffer
  device.queue.writeBuffer(
    storage.instanceBuffer,
    0,
    instanceCpuBuffer,
    0,
    validCount * INSTANCE_FLOAT_COUNT,
  );
  device.queue.writeBuffer(
    storage.pidBuffer,
    0,
    pidDataCpuBuffer,
    0,
    validCount * PID_DATA_FLOAT_COUNT,
  );

  // 更新UBO：投影矩阵 + 时间 + 流动参数（条纹周期按当前缩放折算成世界单位，屏幕观感恒定）
  updatePipeUniform(device, pipeRes, {
    projection: viewProj,
    timeSeconds: timeSec,
    flowPeriodWorld: PIPE_FLOW_PERIOD_PX / Math.max(pixelsPerWorldUnit, 1e-6),
    flowCyclesPerSec: PIPE_FLOW_CYCLES_PER_SEC,
    flowDashDuty: PIPE_FLOW_DASH_DUTY,
  });

  const bindGroup = getPipeBindGroup(device, pipeRes);
  if (!bindGroup) return;

  drawPipeInstanced(pass, pipeRes, bindGroup, pipeTemplateVb, templateVertexCount, validCount);
}

/**
 * 【拾取通路】绘制管线包围盒做离屏拾取
 * shader内部@builtin(vertex_index)生成quad，不需要外部vertexBuffer
 * draw(6, instanceCount)
 * @param pass 拾取RenderPass
 * @param device gpu设备
 * @param pipeRes 管线资源(包含pickPipeline)
 * @param viewProj 相机正交矩阵
 * @param visibleItems 四叉树可见图元
 * @param pixelsPerWorldUnit 当前相机缩放，用于把管线像素粗细折算成世界宽度
 */
export function renderAllVisiblePipesForPick(
  pass: GPURenderPassEncoder,
  device: GPUDevice,
  pipeRes: PipeRenderResources,
  viewProj: Float32Array,
  visibleItems: readonly QuadItem[],
  pixelsPerWorldUnit: number,
): void {
  const storage = getPipeStorageBuffers(device);
  if (!storage || !pipeRes.pickPipeline) return;

  const validCount = packPipeInstanceItems(visibleItems, pixelsPerWorldUnit);
  if (validCount <= 0) return;

  device.queue.writeBuffer(
    storage.instanceBuffer,
    0,
    instanceCpuBuffer,
    0,
    validCount * INSTANCE_FLOAT_COUNT,
  );
  device.queue.writeBuffer(
    storage.pidBuffer,
    0,
    pidDataCpuBuffer,
    0,
    validCount * PID_DATA_FLOAT_COUNT,
  );

  // 拾取通路只用到投影矩阵，流动参数写默认值即可（pick 着色器不读）
  updatePipeUniform(device, pipeRes, {
    projection: viewProj,
    timeSeconds: 0,
    flowPeriodWorld: PIPE_FLOW_PERIOD_PX / Math.max(pixelsPerWorldUnit, 1e-6),
    flowCyclesPerSec: 0,
    flowDashDuty: PIPE_FLOW_DASH_DUTY,
  });

  const bindGroup = getPipeBindGroup(device, pipeRes);
  if (!bindGroup) return;

  drawPipePickInstanced(pass, pipeRes, bindGroup, validCount);
}
