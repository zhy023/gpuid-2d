import type { RectInstance } from '@/engine/types';

export class Renderer2D {
  public device: GPUDevice;
  public context: GPUCanvasContext;
  public format: GPUTextureFormat;

  public vertexBuffer: GPUBuffer;
  public vertexCount: number;

  public projectionBuffer: GPUBuffer;
  public instanceStorageBuffer: GPUBuffer;

  public bindGroup!: GPUBindGroup;
  public bindGroupLayout!: GPUBindGroupLayout; // ✅新增
  public pipeline!: GPURenderPipeline;

  private instanceList: RectInstance[] = [];

  constructor(
    device: GPUDevice,
    context: GPUCanvasContext,
    format: GPUTextureFormat,
    vertexBuffer: GPUBuffer,
    vertexCount: number,
  ) {
    this.device = device;
    this.context = context;
    this.format = format;
    this.vertexBuffer = vertexBuffer;
    this.vertexCount = vertexCount;

    this.projectionBuffer = device.createBuffer({
      size: 64,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    this.instanceStorageBuffer = device.createBuffer({
      size: 100000 * 32,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
  }

  async initPipeline(shaderCode: string) {
    const device = this.device;

    const bindGroupLayout = device.createBindGroupLayout({
      entries: [
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
      ],
    });
    this.bindGroupLayout = bindGroupLayout; // ✅保存到实例

    this.bindGroup = device.createBindGroup({
      layout: bindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: this.projectionBuffer } },
        { binding: 1, resource: { buffer: this.instanceStorageBuffer } },
      ],
    });

    const shaderModule = device.createShaderModule({ code: shaderCode });
    const pipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [bindGroupLayout] });

    this.pipeline = device.createRenderPipeline({
      layout: pipelineLayout,
      vertex: {
        module: shaderModule,
        entryPoint: 'vertexMain',
        buffers: [
          {
            arrayStride: 8,
            attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x2' }],
          },
        ],
      },
      fragment: {
        module: shaderModule,
        entryPoint: 'fsMain',
        targets: [{ format: this.format }],
      },
      primitive: { topology: 'triangle-list' },
    });
  }

  setInstances(list: RectInstance[]) {
    this.instanceList = list;
  }
  uploadInstances() {
    const count = this.instanceList.length;
    const arr = new Float32Array(count * 8);

    for (let i = 0; i < count; i++) {
      const inst = this.instanceList[i];
      const offset = i * 8;
      arr[offset] = inst.sx;
      arr[offset + 1] = inst.sy;
      arr[offset + 2] = inst.beta;
      arr[offset + 3] = inst.tx;
      arr[offset + 4] = inst.ty;
      arr[offset + 5] = inst.selected;
    }

    this.device.queue.writeBuffer(this.instanceStorageBuffer, 0, arr);
  }

  uploadProjectionMatrix(mat: Float32Array) {
    this.device.queue.writeBuffer(this.projectionBuffer, 0, mat);
  }

  render() {
    const encoder = this.device.createCommandEncoder();
    const renderPass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view: this.context.getCurrentTexture().createView(),
          clearValue: { r: 0.05, g: 0.05, b: 0.08, a: 1 },
          loadOp: 'clear',
          storeOp: 'store',
        },
      ],
    });

    renderPass.setPipeline(this.pipeline);
    renderPass.setBindGroup(0, this.bindGroup);
    renderPass.setVertexBuffer(0, this.vertexBuffer);
    renderPass.draw(this.vertexCount, this.instanceList.length);
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
