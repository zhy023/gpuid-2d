import { ALPHA_BLEND_STATE, CANVAS_SAMPLE_COUNT } from '@/core/gpu/render_state';
import {
  createDefaultWhiteTexture,
  createTextureSampler,
  type Texture2d,
} from '@/core/gpu/texture';
import type { RectInstance } from '@/core/types';

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

  private instanceList: RectInstance[] = [];
  // MSAA 颜色目标：渲染到它，再 resolve 到画布纹理
  private msaaTexture: GPUTexture | null = null;
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
      size: 100000 * 48, // InstanceTransform:12*4=48byte（含图集 uv 矩形）
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
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

  /** 画布尺寸变化时同步重建，否则多重采样附件与画布尺寸不一致 */
  resize(width: number, height: number) {
    this.createMsaaTexture(width, height);
  }

  async initPipeline(shaderCode: string) {
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
    // ✅如果存在pid业务buffer，则追加binding2
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

  setInstances(list: RectInstance[]) {
    this.instanceList = list;
  }

  uploadInstances() {
    const count = this.instanceList.length;
    // InstanceTransform 12个f32：sx,sy,beta,tx,ty,selected,pad0,pad1,u0,v0,u1,v1
    const arr = new Float32Array(count * 12);

    for (let i = 0; i < count; i++) {
      const inst = this.instanceList[i];
      const offset = i * 12;
      arr[offset] = inst.sx;
      arr[offset + 1] = inst.sy;
      arr[offset + 2] = inst.beta;
      arr[offset + 3] = inst.tx;
      arr[offset + 4] = inst.ty;
      arr[offset + 5] = inst.selected ?? 0;
      arr[offset + 6] = 0; // pad0 ✅补齐wgsl结构体padding，防止内存错位
      arr[offset + 7] = 0; // pad1 ✅补齐
      // 图集 uv：矩形图元默认整张纹理
      arr[offset + 8] = inst.u0;
      arr[offset + 9] = inst.v0;
      arr[offset + 10] = inst.u1;
      arr[offset + 11] = inst.v1;
    }

    this.device.queue.writeBuffer(this.instanceStorageBuffer, 0, arr);
  }

  uploadProjectionMatrix(mat: Float32Array) {
    this.device.queue.writeBuffer(this.projectionBuffer, 0, mat);
  }

  /**
   * 主渲染：先按实例提交矩形，再允许调用方在同一个 render pass 内追加绘制（如管线）
   * @param drawOverlay 追加绘制回调，在 pass.end() 之前调用
   */
  render(drawOverlay?: (pass: GPURenderPassEncoder) => void) {
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
          clearValue: { r: 0.05, g: 0.05, b: 0.08, a: 1 },
          loadOp: 'clear',
          storeOp: 'discard',
        },
      ],
    });

    renderPass.setPipeline(this.pipeline);
    renderPass.setBindGroup(0, this.bindGroup);
    renderPass.setVertexBuffer(0, this.vertexBuffer);
    renderPass.draw(this.vertexCount, this.instanceList.length);

    drawOverlay?.(renderPass);

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
