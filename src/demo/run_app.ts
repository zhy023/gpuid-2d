import shaderCode from '@/core/shader/core_render/primitive_render.wgsl?raw';
import pickShaderCode from '@/core/shader/core_render/primitive_pick.wgsl?raw';
import type { AABB, RectInstance } from '@/core/types';
import { Camera2d } from '@/core/camera';
import { initWebGPU } from '@/core/gpu/device';
import { createRectVertexBuffer } from '@/core/geometry/geometry';
import { expandAABB } from '@/core/geometry/aabb';
import { Renderer2D } from '@/core/gpu/renderer';
import { RENDER_LAYER, sortRenderLayerDraws, type RenderLayerDraw } from '@/core/gpu/render_layer';
import { WebGpuPicker } from '@/core/gpu/picker';
import { PIPE_LINE_WIDTH_MAX_PX, pipeLineWidthToWorld } from '@/business/pid_schematic/pipe_style';
import valvePickShaderCode from '@/business/pid_schematic/shader/valve_pick.wgsl?raw';
import { createValveDemoScene, toggleValve } from '@/business/pid_schematic/valve_demo';
import {
  getValvesBindGroup,
  getValvesBindGroupLayout,
  initValves,
  renderValves,
  disposeValves,
} from '@/business/pid_schematic/valve_manager';
import type { ValveItem } from '@/business/pid_schematic/types';
import { QuadTree } from '@/core/geometry/quad_tree';
import { GlyphAtlas } from '@/core/text/glyph_atlas';
import { layoutText } from '@/core/text/text_batch';

// test 压测
import { DeviceStressTester } from '@/business/pid_schematic/device_stress_test';
import { PipeStressTester } from '@/business/pid_schematic/pipe_stress_test';
import { disposePipes, renderPipes } from '@/business/pid_schematic/pipe_manager';

export async function runApp() {
  const canvas = document.querySelector<HTMLCanvasElement>('#canvas');
  if (!canvas) throw new Error('找不到 #canvas');
  const canvasElement = canvas;

  // 1.初始化webgpu环境
  const { device, context, format } = await initWebGPU(canvas);

  // 2.创建顶点几何体
  const { vertexBuffer, vertexCount } = createRectVertexBuffer(device);

  // ✅【PID业务buffer预留，压测阶段先不传，后续阀门管线打开】
  // const pidInstanceStorageBuffer = device.createBuffer({
  //   size: 100000 * 16,
  //   usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
  // });

  // 3.初始化渲染器，第二参数pid buffer可选
  const renderer = new Renderer2D(
    device,
    context,
    format,
    vertexBuffer,
    vertexCount,
    // , pidInstanceStorageBuffer // 后续P&ID业务打开这里
  );
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

  // ------------------ 设备图元（阀门）示例 ------------------
  // 一条「阀门—管线—阀门」链 + 拓扑：关闭阀门会把下游管线切回默认样式
  const valveScene = createValveDemoScene();
  // 位号文字：按需字形图集（中文/西文同一路径）
  const glyphAtlas = new GlyphAtlas(device, { fontSizePx: 18 });
  // 醒目示例文字：单独用大字号图集，画在阀门链上方，便于肉眼直接看效果
  const titleAtlas = new GlyphAtlas(device, { fontSizePx: 32 });
  await initValves(
    device,
    format,
    renderer.getVertexLayout(),
    renderer.vertexBuffer,
    renderer.vertexCount,
  );

  // 阀门拾取独立一个 picker：自带拾取纹理，pipeline layout 用阀门自己的绑定
  const valvePicker = new WebGpuPicker(device);
  await valvePicker.init(canvas.width, canvas.height, valvePickShaderCode);
  const valveBindGroupLayout = getValvesBindGroupLayout();
  if (valveBindGroupLayout) {
    valvePicker.setPipelineLayout(
      device.createPipelineLayout({ bindGroupLayouts: [valveBindGroupLayout] }),
    );
    // 阀门拾取着色器用 vertex_index 生成 quad，不需要顶点缓冲
    valvePicker.createPipeline();
  }

  // -----------------------------------------------------------

  // 相机
  const camera = new Camera2d(canvas);

  // 压测初始化：生成的图元直接作为 GPU 实例绘制，并覆盖整个初始视野。
  const worldBounds: AABB = { minX: -20000, minY: -20000, maxX: 20000, maxY: 20000 };
  const pidTester = new DeviceStressTester(worldBounds, 0.002);
  pidTester.generate(50000);
  camera.scale = 0.1;

  let instanceList: RectInstance[] = [];
  let visibleItemsSnapshot: ReturnType<typeof pidTester.tick>['visibleItems'] = [];
  let visibleValves: ValveItem[] = [];

  function updateVisibleInstances() {
    const result = pidTester.tick(camera.getViewportAABB(), camera.isDrag);
    if (!result) return;
    visibleItemsSnapshot = result.visibleItems;

    if (!result.changed) return;

    // ✅直接调用tester提供的转换方法，自带每个item.selected状态
    instanceList = pidTester.buildRectInstanceList(visibleItemsSnapshot);
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

    // 设备图元优先：阀门符号压在管线之上，命中就切换开闭并广播到下游管线
    const valveBindGroup = getValvesBindGroup();
    if (valveBindGroup) {
      const hitValveIndex = await valvePicker.pick(
        pixelX,
        pixelY,
        valveBindGroup,
        renderer.vertexBuffer,
        renderer.vertexCount,
        visibleValves.length,
      );
      const hitValve = hitValveIndex === null ? undefined : visibleValves[hitValveIndex];
      const toggled = hitValve ? toggleValve(valveScene, hitValve.id) : null;
      if (toggled) {
        console.log(
          `阀门 ${toggled.id}：${
            toggled.valveOpen > 0.5 ? '打开（下游恢复流动）' : '关闭（下游恢复默认样式）'
          }`,
        );
        return;
      }
    }

    const hitVisibleIdx = await picker.pick(
      pixelX,
      pixelY,
      renderer.bindGroup,
      renderer.vertexBuffer,
      renderer.vertexCount,
      instanceList.length,
    );

    // 1：清空全部选中状态，修改全局itemMap，不是临时数组
    for (const item of pidTester.itemMap.values()) {
      pidTester.setItemSelected(item.id, false);
    }

    if (hitVisibleIdx !== null) {
      // ⚠️hitVisibleIdx 是【当前可见数组的下标】，不是全局id！
      const hitItem = visibleItemsSnapshot[hitVisibleIdx];
      if (hitItem) {
        pidTester.setItemSelected(hitItem.id, true);
        console.log('✅GPU拾取，全局图元ID：', hitItem.id, '可见数组下标', hitVisibleIdx);
      }
    } else {
      console.log('❌空白，未选中图形');
    }
    updateVisibleInstances(); // 刷新实例数组+上传buffer
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
    valvePicker.resize(canvas.width, canvas.height);
    // MSAA 颜色目标同步重建
    renderer.resize(canvas.width, canvas.height);
  });

  const pipeTester = new PipeStressTester(worldBounds, 0.001);
  await pipeTester.generate(800, device, format);

  /**
   * 管线可见性随相机移动变化，每帧按视口剔除一次。
   * 管线粗细按屏幕像素绘制，最粗 10px 在缩小时对应很宽的世界宽度，
   * 所以剔除视口要外扩「最粗管线的一半世界宽度」，否则贴着屏幕边缘的管线会被提前剔掉。
   */
  function updateVisiblePipes() {
    const cullMargin = pipeLineWidthToWorld(PIPE_LINE_WIDTH_MAX_PX, camera.scale) / 2;
    const cullViewport = expandAABB(camera.getViewportAABB(), cullMargin);
    return pipeTester.tick(cullViewport, camera.isDrag).visibleItems;
  }

  /** 阀门与阀门间示例管线按视口剔除（数量少，直接 AABB 判断即可） */
  function updateVisibleValves(): ValveItem[] {
    const viewport = camera.getViewportAABB();
    return valveScene.valves.filter((valve) => QuadTree.intersect(valve.worldAABB, viewport));
  }

  function getVisibleDemoPipes() {
    const viewport = camera.getViewportAABB();
    return valveScene.pipes.filter((pipe) => QuadTree.intersect(pipe.worldAABB, viewport));
  }

  // 单一渲染循环
  function loop() {
    requestAnimationFrame(loop);
    updateVisibleInstances();
    const visiblePipes = updateVisiblePipes();
    visibleValves = updateVisibleValves();
    // 阀门位号：每字一个实例，图集 uv 写在实例里，与矩形共用一次实例化绘制
    const titleInstances = layoutText(titleAtlas, '你好', {
      x: -260,
      y: -900,
      pixelsPerWorldUnit: camera.scale,
      // 文字自带颜色，格子其余部分保持透明（不铺底板）
      color: [1.0, 0.78, 0.25, 1],
    }).instances;
    const tagInstances = visibleValves.flatMap(
      (valve) =>
        layoutText(glyphAtlas, `你好 ${valve.id % 1000}`, {
          x: valve.tx - 60,
          y: valve.ty + 100,
          pixelsPerWorldUnit: camera.scale,
          color: [0.55, 0.85, 1.0, 1],
        }).instances,
    );
    const textInstances = [...titleInstances, ...tagInstances];
    if (textInstances.length > 0) {
      renderer.setInstances([...instanceList, ...textInstances]);
      renderer.uploadInstances();
    }
    const visibleDemoPipes = getVisibleDemoPipes();
    const projMat = camera.getCameraProjectionMatrix();
    renderer.uploadProjectionMatrix(projMat);
    // 按层序组装覆盖层绘制：管线在下、设备符号在上（顺序由 core 的层契约决定）
    const layerDraws: RenderLayerDraw[] = [
      {
        layer: RENDER_LAYER.pipe,
        // 压测管线与阀门示例管线共用一次实例化绘制
        draw: (pass) =>
          renderPipes(pass, projMat, [...visiblePipes, ...visibleDemoPipes], camera.scale),
      },
      {
        layer: RENDER_LAYER.device,
        draw: (pass) => renderValves(pass, projMat, visibleValves, camera.scale),
      },
    ];

    // 矩形、管线、设备图元共用同一个 render pass，避免多开 pass 与多余 submit
    renderer.render((pass) => {
      for (const item of sortRenderLayerDraws(layerDraws)) item.draw(pass);
      // 文字批次：同一实例缓冲，换成字形图集纹理绘制（两段区间各用自己的图集）
      renderer.drawTextureBatch(
        pass,
        titleAtlas.texture.view,
        titleAtlas.sampler,
        instanceList.length,
        titleInstances.length,
      );
      renderer.drawTextureBatch(
        pass,
        glyphAtlas.texture.view,
        glyphAtlas.sampler,
        instanceList.length + titleInstances.length,
        tagInstances.length,
      );
    });
  }

  loop();

  // 页面卸载时释放 GPU 资源（纹理/buffer 必须显式销毁）
  window.addEventListener(
    'pagehide',
    () => {
      renderer.dispose();
      disposePipes();
      disposeValves();
    },
    { once: true },
  );
}
