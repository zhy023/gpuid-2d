/**
 * 应用级装配：一次拿到设备、画布上下文、渲染器、默认拾取器、画布表面与相机。
 *
 * 这几步有固定顺序（先有渲染器才能拿它的绑定布局建拾取器；先有尺寸才能建拾取纹理），
 * 每个使用方都会重复写一遍，收进内核；业务要额外登记 resize 目标时用 options 传入。
 */
import { Camera2d } from '@/core/camera';
import { initWebGPU } from '@/core/gpu/device';
import { createRendererPicker, type WebGpuPicker } from '@/core/gpu/picker';
import { Renderer2D } from '@/core/gpu/renderer';
import { CanvasSurface, type ResizableTarget } from '@/core/gpu/surface';
import { createRectVertexBuffer } from '@/core/geometry/geometry';

export interface RendererContext {
  device: GPUDevice;
  context: GPUCanvasContext;
  format: GPUTextureFormat;
  renderer: Renderer2D;
  /** 默认拾取器（复用渲染器的绑定布局与顶点布局） */
  picker: WebGpuPicker;
  /** 画布表面：尺寸变化时统一重配上下文并重建内部纹理 */
  surface: CanvasSurface;
  camera: Camera2d;
  /** 基础图元模板顶点（默认拾取器与业务符号模板都用它） */
  vertexBuffer: GPUBuffer;
  vertexCount: number;
}

export interface RendererContextOptions {
  /** 额外跟随画布尺寸重建的对象（例如业务设备拾取器） */
  resizeTargets?: readonly ResizableTarget[];
}

export async function createRendererContext(
  canvas: HTMLCanvasElement,
  options: RendererContextOptions = {},
): Promise<RendererContext> {
  const { device, context, format } = await initWebGPU(canvas);

  const { vertexBuffer, vertexCount } = createRectVertexBuffer(device);
  const renderer = new Renderer2D(device, context, format, vertexBuffer, vertexCount);
  await renderer.initPipeline();

  const picker = await createRendererPicker(device, renderer, canvas.width, canvas.height);
  const surface = new CanvasSurface({
    canvas,
    device,
    context,
    format,
    resizeTargets: [renderer, picker, ...(options.resizeTargets ?? [])],
  });
  const camera = new Camera2d(canvas);

  return {
    device,
    context,
    format,
    renderer,
    picker,
    surface,
    camera,
    vertexBuffer,
    vertexCount,
  };
}
