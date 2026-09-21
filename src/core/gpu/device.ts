/**
 * WebGPU上下文初始化：adapter / device / canvas context
 */
export interface InitWebGpuOptions {
  /**
   * 设备丢失回调，用于自动重连。
   * 注意：重连必须重新 `requestAdapter()`——适配器被设备消费过就不能再用。
   */
  onDeviceLost?: (info: GPUDeviceLostInfo) => void;
}

export async function initWebGPU(canvas: HTMLCanvasElement, options: InitWebGpuOptions = {}) {
  if (!navigator.gpu) throw new Error('浏览器不支持WebGPU');

  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) throw new Error('获取GPU Adapter失败');

  const device = await adapter.requestDevice();

  /* 设备丢失（驱动重置、页面被回收等）：显式报错，避免静默黑屏 */
  void device.lost.then((info) => {
    console.error(`[gpuid] WebGPU 设备丢失：reason=${info.reason} message=${info.message}`);
    options.onDeviceLost?.(info);
  });

  const context = canvas.getContext('webgpu');
  if (!context) throw new Error('获取WebGPU Context失败');

  const format = navigator.gpu.getPreferredCanvasFormat();
  context.configure({ device, format, alphaMode: 'opaque' });

  return { adapter, device, context, format };
}
