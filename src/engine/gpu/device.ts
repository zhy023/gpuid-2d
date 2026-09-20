/**
 * WebGPU上下文初始化：adapter / device / canvas context
 */
export async function initWebGPU(canvas: HTMLCanvasElement) {
  if (!navigator.gpu) throw new Error('浏览器不支持WebGPU');

  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) throw new Error('获取GPU Adapter失败');

  const device = await adapter.requestDevice();
  const context = canvas.getContext('webgpu');
  if (!context) throw new Error('获取WebGPU Context失败');

  const format = navigator.gpu.getPreferredCanvasFormat();
  context.configure({ device, format, alphaMode: 'opaque' });

  return { adapter, device, context, format };
}
