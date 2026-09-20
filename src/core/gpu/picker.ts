/**
 * WebGPU 拾取模块 rgba32uint
 * 仅点击时执行，不占用主渲染循环
 */

import defaultPickWgsl from '@/core/shader/core_render/primitive_pick.wgsl?raw';

/** 拾取管线需要复用的布局来源（Renderer2D 满足这个结构） */
export interface PickLayoutSource {
  bindGroupLayout: GPUBindGroupLayout;
  getVertexLayout(): GPUVertexBufferLayout;
}

/**
 * 用渲染器的布局创建拾取器。
 *
 * 拾取着色器读取的正是渲染器上传的实例数据，所以必须复用它的 bindGroupLayout
 * 与顶点布局；这套胶水收在内核里，使用方只需给设备、布局来源与画布尺寸。
 */
export async function createRendererPicker(
  device: GPUDevice,
  source: PickLayoutSource,
  width: number,
  height: number,
): Promise<WebGpuPicker> {
  const picker = new WebGpuPicker(device);
  await picker.init(width, height);
  picker.setPipelineLayout(
    device.createPipelineLayout({ bindGroupLayouts: [source.bindGroupLayout] }),
  );
  picker.createPipeline(source.getVertexLayout());
  return picker;
}

export class WebGpuPicker {
  private device: GPUDevice;

  private pickTexture?: GPUTexture;
  private pickDepthTexture?: GPUTexture;
  private pickReadBuffer?: GPUBuffer;

  private pickShaderModule?: GPUShaderModule;
  private pickPipelineLayout?: GPUPipelineLayout;
  public pickPipeline?: GPURenderPipeline;

  private _isPicking = false; // 防重复点击锁

  constructor(device: GPUDevice) {
    this.device = device;
  }

  /**
   * 初始化拾取资源：默认用内核自带的拾取着色器，业务设备（阀门等）可传入自己的着色器。
   */
  async init(w: number, h: number, pickShaderCode: string = defaultPickWgsl) {
    const device = this.device;

    this.pickTexture = device.createTexture({
      size: [w, h],
      format: 'rgba32uint',
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
    });

    this.pickDepthTexture = device.createTexture({
      size: [w, h],
      format: 'depth24plus',
      usage: GPUTextureUsage.RENDER_ATTACHMENT,
    });

    this.pickReadBuffer = device.createBuffer({
      // WebGPU requires bytesPerRow to be aligned to 256 bytes.
      size: 256,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });

    this.pickShaderModule = device.createShaderModule({ code: pickShaderCode });
  }

  setPipelineLayout(layout: GPUPipelineLayout) {
    this.pickPipelineLayout = layout;
  }

  /**
   * 创建拾取 pipeline
   * @param vertexBufferLayout 顶点布局；着色器自带顶点（用 vertex_index 生成几何）时传 undefined
   */
  createPipeline(vertexBufferLayout?: GPUVertexBufferLayout) {
    if (!this.pickShaderModule || !this.pickPipelineLayout) throw new Error('picker not init');
    // 入口函数名与 core_render / features 下的着色器保持一致
    this.pickPipeline = this.device.createRenderPipeline({
      layout: this.pickPipelineLayout,
      vertex: {
        module: this.pickShaderModule,
        entryPoint: 'vertexMain',
        buffers: vertexBufferLayout ? [vertexBufferLayout] : [],
      },
      fragment: {
        module: this.pickShaderModule,
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
  }

  resize(w: number, h: number) {
    this.pickTexture?.destroy();
    this.pickDepthTexture?.destroy();

    const device = this.device;
    this.pickTexture = device.createTexture({
      size: [w, h],
      format: 'rgba32uint',
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
    });
    this.pickDepthTexture = device.createTexture({
      size: [w, h],
      format: 'depth24plus',
      usage: GPUTextureUsage.RENDER_ATTACHMENT,
    });
  }

  /**
   * 用客户端坐标拾取：屏幕坐标 → 画布像素的换算在内部完成，
   * 使用方（demo/业务）不必再写一遍 getBoundingClientRect 那套换算。
   */
  async pickAt(
    canvas: HTMLCanvasElement,
    clientX: number,
    clientY: number,
    bindGroup: GPUBindGroup,
    vertexBuffer: GPUBuffer,
    vertexCount: number,
    instanceCount: number,
  ): Promise<number | null> {
    const rect = canvas.getBoundingClientRect();
    const pixelX = ((clientX - rect.left) * canvas.width) / rect.width;
    const pixelY = ((clientY - rect.top) * canvas.height) / rect.height;
    return this.pick(pixelX, pixelY, bindGroup, vertexBuffer, vertexCount, instanceCount);
  }

  /**
   * 执行拾取，普通draw模式（非drawIndexed）
   * @param x canvas offsetX
   * @param y canvas offsetY
   * @param bindGroup viewProj bindGroup
   * @param vertexBuffer
   * @param vertexCount 单个图元顶点数量
   * @param instanceCount 当前可见实例数量
   */
  async pick(
    x: number,
    y: number,
    bindGroup: GPUBindGroup,
    vertexBuffer: GPUBuffer,
    vertexCount: number,
    instanceCount: number,
  ): Promise<number | null> {
    if (this._isPicking) return null;
    if (!this.pickPipeline || !this.pickTexture || !this.pickDepthTexture || !this.pickReadBuffer)
      return null;

    this._isPicking = true;
    try {
      const encoder = this.device.createCommandEncoder();
      const pickView = this.pickTexture.createView();
      const depthView = this.pickDepthTexture.createView();

      const pass = encoder.beginRenderPass({
        colorAttachments: [
          {
            view: pickView,
            clearValue: { r: 0, g: 0, b: 0, a: 0 },
            loadOp: 'clear',
            storeOp: 'store',
          },
        ],
        depthStencilAttachment: {
          view: depthView,
          depthClearValue: 1.0,
          depthLoadOp: 'clear',
          depthStoreOp: 'store',
        },
      });

      pass.setPipeline(this.pickPipeline);
      pass.setBindGroup(0, bindGroup);
      pass.setVertexBuffer(0, vertexBuffer);
      pass.draw(vertexCount, instanceCount);
      pass.end();

      // 标准完整copyTextureToBuffer参数，修复width undefined
      encoder.copyTextureToBuffer(
        {
          texture: this.pickTexture,
          origin: [Math.floor(x), Math.floor(y), 0],
        },
        {
          buffer: this.pickReadBuffer,
          offset: 0,
          bytesPerRow: 256,
        },
        {
          width: 1,
          height: 1,
          depthOrArrayLayers: 1,
        },
      );

      this.device.queue.submit([encoder.finish()]);

      await this.pickReadBuffer.mapAsync(GPUMapMode.READ);
      const res = new Uint32Array(this.pickReadBuffer.getMappedRange());
      const idFromTexture = res[0];
      this.pickReadBuffer.unmap();

      if (idFromTexture === 0) {
        return null;
      }
      return idFromTexture - 1;
    } finally {
      this._isPicking = false;
    }
  }

  destroy() {
    this.pickTexture?.destroy();
    this.pickDepthTexture?.destroy();
    this.pickReadBuffer?.destroy();
  }
}
