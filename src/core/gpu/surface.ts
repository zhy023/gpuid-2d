/**
 * 画布表面（canvas surface）生命周期。
 *
 * 尺寸变化需要同步处理三件事：画布尺寸、WebGPU 上下文重配、内部纹理重建
 * （MSAA 颜色目标、拾取纹理等）。把它们收进内核，使用方只需登记「哪些对象需要 resize」，
 * 不必知道内部有哪些资源要跟着重建。
 */

/** 需要跟随画布尺寸重建内部资源的对象（Renderer2D、各 picker 都满足） */
export interface ResizableTarget {
  resize(width: number, height: number): void;
}

export interface CanvasSurfaceOptions {
  canvas: HTMLCanvasElement;
  device: GPUDevice;
  context: GPUCanvasContext;
  format: GPUTextureFormat;
  /** 注册进来的目标会在尺寸变化后按画布像素尺寸重建 */
  resizeTargets?: readonly ResizableTarget[];
  /** 画布上下文的 alpha 模式，默认不透明 */
  alphaMode?: GPUCanvasAlphaMode;
}

export class CanvasSurface {
  private readonly canvas: HTMLCanvasElement;
  private readonly device: GPUDevice;
  private readonly context: GPUCanvasContext;
  private readonly format: GPUTextureFormat;
  private readonly alphaMode: GPUCanvasAlphaMode;
  private readonly resizeTargets: readonly ResizableTarget[];

  constructor(options: CanvasSurfaceOptions) {
    this.canvas = options.canvas;
    this.device = options.device;
    this.context = options.context;
    this.format = options.format;
    this.alphaMode = options.alphaMode ?? 'opaque';
    this.resizeTargets = options.resizeTargets ?? [];
  }

  /** 按当前 CSS 尺寸同步画布与所有从属资源 */
  sync(): void {
    const { canvas } = this;
    canvas.width = canvas.clientWidth;
    canvas.height = canvas.clientHeight;
    // 尺寸变了必须重配上下文，否则画面会被拉伸
    this.context.configure({
      device: this.device,
      format: this.format,
      alphaMode: this.alphaMode,
    });
    for (const target of this.resizeTargets) {
      target.resize(canvas.width, canvas.height);
    }
  }

  /** 监听窗口 resize；返回解绑函数 */
  bindWindowResize(): () => void {
    const handler = () => this.sync();
    window.addEventListener('resize', handler);
    return () => window.removeEventListener('resize', handler);
  }
}
