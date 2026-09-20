import shaderCode from '@/engine/shader/shader.wgsl?raw';
import pickShaderCode from '@/engine/shader/pick.wgsl?raw';
import type { AABB, RectInstance } from '@/engine/types';
import { Camera2d } from '@/engine/camera';
import { initWebGPU } from '@/engine/gpu/device';
import { createRectVertexBuffer } from '@/engine/geometry/geometry';
import { Renderer2D } from '@/engine/gpu/renderer';
import { WebGpuPicker } from '@/engine/gpu/picker';

// test 压测
import { PidStressTester } from '@/scene/instances';
import { PipeStressTester } from '@/scene/pipeline_test';

export async function runApp() {
  const canvas = document.querySelector<HTMLCanvasElement>('#canvas');
  if (!canvas) throw new Error('找不到 #canvas');
  const canvasElement = canvas;

  // 1.初始化webgpu环境
  const { device, context, format } = await initWebGPU(canvas);

  // 2.创建顶点几何体
  const { vertexBuffer, vertexCount } = createRectVertexBuffer(device);

  // 3.初始化渲染器
  const renderer = new Renderer2D(device, context, format, vertexBuffer, vertexCount);
  await renderer.initPipeline(shaderCode);

  // ---------------------- 初始化拾取模块 ----------------------
  const picker = new WebGpuPicker(device);
  await picker.init(canvas.width, canvas.height, pickShaderCode);
  // 拾取复用渲染器同一个 bindGroupLayout
  const pickPipelineLayout = device.createPipelineLayout({
    bindGroupLayouts: [renderer.bindGroupLayout],
  });
  picker.setPipelineLayout(pickPipelineLayout);
  picker.createPipeline(renderer.getVertexLayout());

  // -----------------------------------------------------------

  // 相机
  const camera = new Camera2d(canvas);

  // 压测初始化：生成的图元直接作为 GPU 实例绘制，并覆盖整个初始视野。
  const worldBounds: AABB = { minX: -20000, minY: -20000, maxX: 20000, maxY: 20000 };
  const pidTester = new PidStressTester(worldBounds, 0.002);
  pidTester.generate(50000);
  camera.scale = 0.1;

  let instanceList: RectInstance[] = [];

  function updateVisibleInstances() {
    const result = pidTester.tick(camera.getViewportAABB(), camera.isDrag);
    if (!result || !result.changed) return;

    instanceList = result.visibleItems.map((item) => ({
      tx: item.tx,
      ty: item.ty,
      sx: item.sx,
      sy: item.sy,
      beta: item.beta,
      selected: 0,
    }));
    renderer.setInstances(instanceList);
    renderer.uploadInstances();
    console.log(`视口剔除：${result.visibleItems.length} / 50000 个图元`);
  }

  updateVisibleInstances();

  // ✅鼠标点击：GPU拾取
  async function onMouseDown(e: MouseEvent) {
    e.stopPropagation();

    const rect = canvasElement.getBoundingClientRect();
    const pixelScaleX = canvasElement.width / rect.width;
    const pixelScaleY = canvasElement.height / rect.height;
    const pixelX = (e.clientX - rect.left) * pixelScaleX;
    const pixelY = (e.clientY - rect.top) * pixelScaleY;

    const hitIndex = await picker.pick(
      pixelX,
      pixelY,
      renderer.bindGroup,
      renderer.vertexBuffer,
      renderer.vertexCount,
      instanceList.length,
    );

    // 全部取消选中
    instanceList.forEach((inst) => (inst.selected = 0));
    if (hitIndex !== null) {
      instanceList[hitIndex].selected = 1;
      console.log('✅GPU拾取选中实例下标：', hitIndex);
    } else {
      console.log('❌空白，未选中图形');
    }
    renderer.uploadInstances();
  }

  canvas.removeEventListener('mousedown', onMouseDown);
  canvas.addEventListener('mousedown', onMouseDown);

  // 窗口resize同步canvas尺寸 + 相机 + 拾取纹理
  window.addEventListener('resize', () => {
    canvas.width = canvas.clientWidth;
    canvas.height = canvas.clientHeight;
    // 重点：WebGPU上下文重新配置，防止画面拉伸模糊
    context.configure({
      device,
      format,
      alphaMode: 'opaque',
    });
    camera.resize(canvas.width, canvas.height);
    picker.resize(canvas.width, canvas.height);
  });

  const pipeTester = new PipeStressTester(worldBounds, 0.001);
  await pipeTester.generate(800, device);

  // ========== 单一渲染循环 ==========
  function loop() {
    requestAnimationFrame(loop);
    updateVisibleInstances();
    const projMat = camera.getCameraProjectionMatrix();
    renderer.uploadProjectionMatrix(projMat);
    renderer.render();
  }
  loop();
}
