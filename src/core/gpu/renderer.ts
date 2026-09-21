import { ALPHA_BLEND_STATE, CANVAS_SAMPLE_COUNT } from '@/core/gpu/render_state';
import {
  createDefaultWhiteTexture,
  createTextureSampler,
  type Texture2d,
} from '@/core/gpu/texture';
import type { PrimitiveInstance } from '@/core/types';
import defaultRenderWgsl from '@/core/shader/generated/core_render/primitive_render';

/** 实例契约：8 个基字段（变换/选中/形状/填充）+ 图集 uv(4) + 逐实例颜色(4) = 16 × f32 = 64B */
const INSTANCE_FLOAT_COUNT = 16;
/** 实例缓冲容量：基础批次与各覆盖批次共用这一条缓冲 */
const MAX_INSTANCE_COUNT = 100_000;

/** 一次纹理批次：绑定纹理与采样器，绘制基础实例批次之后的连续实例区间 */
export interface TextureBatch {
  textureView: GPUTextureView;
  sampler: GPUSampler;
  instanceCount: number;
}

/** 自带纹理的实例批次（文字图集、贴图符号等） */
export interface InstanceTextureBatch {
  instances: readonly PrimitiveInstance[];
  textureView: GPUTextureView;
  sampler: GPUSampler;
}

/** 把一个实例写进打包数组的第 index 个槽位，字段顺序与 WGSL `InstanceTransform` 一致 */
function writeInstance(data: Float32Array, index: number, instance: PrimitiveInstance): void {
  const offset = index * INSTANCE_FLOAT_COUNT;
  data[offset] = instance.sx;
  data[offset + 1] = instance.sy;
  data[offset + 2] = instance.beta;
  data[offset + 3] = instance.tx;
  data[offset + 4] = instance.ty;
  data[offset + 5] = instance.selected ?? 0;
  // shape：方框 / 圆（着色器按它裁形状），pad1 仍留空
  data[offset + 6] = instance.shape ?? 0;
  // pad1 改成「描边宽度（屏幕像素）」：只有描边环实例用得到，其余实例写 0
  data[offset + 7] = instance.borderWidthPx ?? 0;
  data[offset + 8] = instance.u0;
  data[offset + 9] = instance.v0;
  data[offset + 10] = instance.u1;
  data[offset + 11] = instance.v1;
  data[offset + 12] = instance.colorR;
  data[offset + 13] = instance.colorG;
  data[offset + 14] = instance.colorB;
  data[offset + 15] = instance.colorA;
}

/** 把实例列表打包成 GPU 缓冲格式（每个实例 `INSTANCE_FLOAT_COUNT` 个 f32） */
export function packInstances(list: readonly PrimitiveInstance[]): Float32Array {
  const data = new Float32Array(list.length * INSTANCE_FLOAT_COUNT);
  for (let i = 0; i < list.length; i += 1) writeInstance(data, i, list[i]);
  return data;
}

export class Renderer2D {
  public device: GPUDevice;
  public context: GPUCanvasContext;
  public format: GPUTextureFormat;

  public vertexBuffer: GPUBuffer;
  public vertexCount: number;

  public projectionBuffer: GPUBuffer;
  public instanceStorageBuffer: GPUBuffer;
  // ✅新增：P&ID业务属性storage buffer(阀门开关、管线参数)
  public pidInstanceStorageBuffer?: GPUBuffer;

  public bindGroup!: GPUBindGroup;
  public bindGroupLayout!: GPUBindGroupLayout;
  public pipeline!: GPURenderPipeline;
  /** MSAA 采样数：同 pass 内的业务 pipeline 必须与它一致 */
  public readonly sampleCount = CANVAS_SAMPLE_COUNT;

  /** 基础批次实例数：绘制数量只看它，覆盖批次由各自的纹理批次绘制 */
  private baseInstanceCount = 0;
  // MSAA 颜色目标：渲染到它，再 resolve 到画布纹理
  private msaaTexture: GPUTexture | null = null;
  // 背景色：默认很淡的灰，工业图纸长时间观看更舒服
  private clearColor: GPUColor = { r: 0.96, g: 0.96, b: 0.96, a: 1 };
  // 默认纹理绑定：不贴图的图元采样到白色，外观不变
  private defaultTexture!: Texture2d;
  private defaultSampler!: GPUSampler;

  constructor(
    device: GPUDevice,
    context: GPUCanvasContext,
    format: GPUTextureFormat,
    vertexBuffer: GPUBuffer,
    vertexCount: number,
    pidInstanceStorageBuffer?: GPUBuffer, // ✅可选传入pid业务buffer
  ) {
    this.device = device;
    this.context = context;
    this.format = format;
    this.vertexBuffer = vertexBuffer;
    this.vertexCount = vertexCount;
    this.pidInstanceStorageBuffer = pidInstanceStorageBuffer;

    this.projectionBuffer = device.createBuffer({
      size: 64,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    this.instanceStorageBuffer = device.createBuffer({
      size: MAX_INSTANCE_COUNT * INSTANCE_FLOAT_COUNT * 4,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      label: 'core-instance-storage-buffer',
    });

    this.createMsaaTexture(context.canvas.width, context.canvas.height);
    this.defaultTexture = createDefaultWhiteTexture(device);
    this.defaultSampler = createTextureSampler(device);
  }

  /** 重建 MSAA 颜色目标（构造与 resize 时调用） */
  private createMsaaTexture(width: number, height: number) {
    this.msaaTexture?.destroy();
    this.msaaTexture = this.device.createTexture({
      size: [Math.max(width, 1), Math.max(height, 1)],
      format: this.format,
      sampleCount: this.sampleCount,
      usage: GPUTextureUsage.RENDER_ATTACHMENT,
      label: 'canvas-msaa-color',
    });
  }

  /**
   * 释放持有的 GPU 资源。纹理与 buffer 必须显式 destroy；
   * pipeline / bindGroup / layout 由 GC 回收，无需手动销毁。
   */
  dispose() {
    this.msaaTexture?.destroy();
    this.msaaTexture = null;
    this.defaultTexture.texture.destroy();
    this.projectionBuffer.destroy();
    this.instanceStorageBuffer.destroy();
  }

  /**
   * 一次性提交整帧：基础图元批次 + 若干「自带纹理的实例批次」（文字、贴图符号）。
   *
   * 打包与上传都在这里做（调用方只给出批次）：缓冲里存放「基础批次 + 各覆盖批次依次拼接」，
   * 但**绘制数量只按基础批次算**，覆盖批次由各自的纹理批次绘制。
   * （历史 bug：覆盖实例被基础批次用默认白纹理也画了一遍，文字于是成了实色方块。）
   */
  renderComposite(options: {
    instances: readonly PrimitiveInstance[];
    extraBatches?: readonly InstanceTextureBatch[];
    /** 在基础实例批次**之前**绘制（管线这类要被设备压住的层） */
    drawUnderlay?: (pass: GPURenderPassEncoder) => void;
    drawOverlay?: (pass: GPURenderPassEncoder) => void;
  }) {
    const { instances, extraBatches = [], drawUnderlay, drawOverlay } = options;
    const batches = extraBatches.filter((batch) => batch.instances.length > 0);

    const totalCount = batches.reduce(
      (sum, batch) => sum + batch.instances.length,
      instances.length,
    );
    if (totalCount > MAX_INSTANCE_COUNT) {
      throw new Error(`实例数超出缓冲容量：${totalCount} > ${MAX_INSTANCE_COUNT}`);
    }

    // 一次打包成连续缓冲，避免先拼一个中间数组再打包
    const packed = new Float32Array(totalCount * INSTANCE_FLOAT_COUNT);
    let cursor = 0;
    for (const instance of instances) writeInstance(packed, cursor++, instance);
    for (const batch of batches) {
      for (const instance of batch.instances) writeInstance(packed, cursor++, instance);
    }

    if (totalCount > 0) {
      this.device.queue.writeBuffer(this.instanceStorageBuffer, 0, packed);
    }

    // 绘制数量只看基础批次
    this.baseInstanceCount = instances.length;
    this.render(
      drawUnderlay,
      drawOverlay,
      batches.map((batch) => ({
        textureView: batch.textureView,
        sampler: batch.sampler,
        instanceCount: batch.instances.length,
      })),
    );
  }

  /**
   * 用指定纹理绘制一段实例。
   * 文字/符号图集与普通图元共用同一个实例缓冲与 pipeline，只是换绑纹理，
   * firstInstance 让 @builtin(instance_index) 继续指向缓冲里正确的实例。
   */
  drawTextureBatch(
    pass: GPURenderPassEncoder,
    textureView: GPUTextureView,
    sampler: GPUSampler,
    firstInstance: number,
    instanceCount: number,
  ) {
    if (instanceCount <= 0) return;

    const bindGroup = this.device.createBindGroup({
      layout: this.bindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: this.projectionBuffer } },
        { binding: 1, resource: { buffer: this.instanceStorageBuffer } },
        { binding: 3, resource: textureView },
        { binding: 4, resource: sampler },
      ],
    });

    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.setVertexBuffer(0, this.vertexBuffer);
    pass.draw(this.vertexCount, instanceCount, 0, firstInstance);
  }

  /** 画布尺寸变化时同步重建，否则多重采样附件与画布尺寸不一致 */
  resize(width: number, height: number) {
    this.createMsaaTexture(width, height);
  }

  /** 设置背景色（每帧清屏用） */
  setClearColor(color: GPUColor) {
    this.clearColor = color;
  }

  /** 内核默认白纹理与采样器：业务要画「不贴图」的批次（例如描边环）时用它 */
  getDefaultTexture(): Texture2d {
    return this.defaultTexture;
  }

  getDefaultSampler(): GPUSampler {
    return this.defaultSampler;
  }

  /**
   * 初始化渲染管线：默认用内核自带的图元着色器，传入 shaderCode 可覆盖。
   * 着色器属于内核资产，使用方不必再 import WGSL。
   */
  async initPipeline(shaderCode: string = defaultRenderWgsl) {
    const device = this.device;

    const bindGroupLayoutEntries: GPUBindGroupLayoutEntry[] = [
      {
        binding: 0,
        visibility: GPUShaderStage.VERTEX,
        buffer: { type: 'uniform' },
      },
      {
        binding: 1,
        visibility: GPUShaderStage.VERTEX,
        buffer: { type: 'read-only-storage' },
      },
      // 纹理能力：binding3 纹理 + binding4 采样器（fragment 阶段采样）
      {
        binding: 3,
        visibility: GPUShaderStage.FRAGMENT,
        texture: { sampleType: 'float' },
      },
      {
        binding: 4,
        visibility: GPUShaderStage.FRAGMENT,
        sampler: { type: 'filtering' },
      },
    ];

    // 如果存在pid业务buffer，则追加binding2
    if (this.pidInstanceStorageBuffer) {
      bindGroupLayoutEntries.push({
        binding: 2,
        visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
        buffer: { type: 'read-only-storage' },
      });
    }

    const bindGroupLayout = device.createBindGroupLayout({
      entries: bindGroupLayoutEntries,
    });

    this.bindGroupLayout = bindGroupLayout;

    // build bindGroup entries
    const bindGroupEntries: GPUBindGroupEntry[] = [
      { binding: 0, resource: { buffer: this.projectionBuffer } },
      { binding: 1, resource: { buffer: this.instanceStorageBuffer } },
      { binding: 3, resource: this.defaultTexture.view },
      { binding: 4, resource: this.defaultSampler },
    ];

    if (this.pidInstanceStorageBuffer) {
      bindGroupEntries.push({ binding: 2, resource: { buffer: this.pidInstanceStorageBuffer! } });
    }

    this.bindGroup = device.createBindGroup({
      layout: bindGroupLayout,
      entries: bindGroupEntries,
    });

    const shaderModule = device.createShaderModule({ code: shaderCode });
    const pipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [bindGroupLayout] });

    this.pipeline = device.createRenderPipeline({
      layout: pipelineLayout,
      vertex: {
        module: shaderModule,
        entryPoint: 'vertexMain', // ✅对齐wgsl入口函数名
        buffers: [
          {
            arrayStride: 8,
            attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x2' }],
          },
        ],
      },
      fragment: {
        module: shaderModule,
        entryPoint: 'fragmentMain', // ✅对齐wgsl入口函数名
        targets: [{ format: this.format, blend: ALPHA_BLEND_STATE }],
      },
      primitive: { topology: 'triangle-list' },
      multisample: { count: this.sampleCount },
    });
  }

  uploadProjectionMatrix(mat: Float32Array) {
    this.device.queue.writeBuffer(this.projectionBuffer, 0, mat);
  }

  /**
   * 主渲染：先提交基础实例批次，再允许调用方在同一个 render pass 内追加绘制（如管线）
   * @param drawOverlay 追加绘制回调，在 pass.end() 之前调用
   */
  render(
    drawUnderlay?: (pass: GPURenderPassEncoder) => void,
    drawOverlay?: (pass: GPURenderPassEncoder) => void,
    textureBatches: readonly TextureBatch[] = [],
  ) {
    if (!this.msaaTexture) {
      this.createMsaaTexture(this.context.canvas.width, this.context.canvas.height);
    }

    const encoder = this.device.createCommandEncoder();
    const renderPass = encoder.beginRenderPass({
      colorAttachments: [
        {
          // 多重采样渲染到 MSAA 纹理，再 resolve 到画布纹理
          view: this.msaaTexture!.createView(),
          resolveTarget: this.context.getCurrentTexture().createView(),
          clearValue: this.clearColor,
          loadOp: 'clear',
          storeOp: 'discard',
        },
      ],
    });

    // 基础批次为空时跳过（例如某个功能测试只画管线/文字），避免 0 实例的无效绘制
    // 顺序：先画 over/under 里声明的底层（管线），再画主体实例（设备），最后是纹理批次（符号/文字）
    drawUnderlay?.(renderPass);
    if (this.baseInstanceCount > 0) {
      renderPass.setPipeline(this.pipeline);
      renderPass.setBindGroup(0, this.bindGroup);
      renderPass.setVertexBuffer(0, this.vertexBuffer);
      renderPass.draw(this.vertexCount, this.baseInstanceCount);
    }

    drawOverlay?.(renderPass);

    // 纹理批次（文字/贴图）紧跟基础实例之后，区间偏移在这里累加，调用方不必手算
    let firstInstance = this.baseInstanceCount;
    for (const batch of textureBatches) {
      if (batch.instanceCount <= 0) continue;
      this.drawTextureBatch(
        renderPass,
        batch.textureView,
        batch.sampler,
        firstInstance,
        batch.instanceCount,
      );
      firstInstance += batch.instanceCount;
    }

    renderPass.end();

    this.device.queue.submit([encoder.finish()]);
  }

  // 对外获取顶点buffer布局，给拾取管线复用
  getVertexLayout(): GPUVertexBufferLayout {
    return {
      arrayStride: 8,
      attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x2' }],
    };
  }
}
