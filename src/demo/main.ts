import type { RectInstance } from '@/core/types';
import { Camera2d } from '@/core/camera';
import { initWebGPU } from '@/core/gpu/device';
import { createRectVertexBuffer } from '@/core/geometry/geometry';
import { expandAABB } from '@/core/geometry/aabb';
import { Renderer2D } from '@/core/gpu/renderer';
import { RENDER_LAYER, sortRenderLayerDraws, type RenderLayerDraw } from '@/core/gpu/render_layer';
import { createRendererPicker } from '@/core/gpu/picker';
import { PIPE_LINE_WIDTH_MAX_PX, pipeLineWidthToWorld } from '@/business/pid_schematic/pipe_style';
import { bindDemoInput } from '@/demo/input';
import { CanvasSurface } from '@/core/gpu/surface';
import { createDemoScene } from '@/demo/scene';
import {
  getValvesPicker,
  initValves,
  disposeValves,
  getValveResources,
} from '@/business/pid_schematic/valve_manager';
import { uploadValveInstances } from '@/business/pid_schematic/valve_instances';
import type { ValveItem } from '@/business/pid_schematic/types';
import { QuadTree } from '@/core/geometry/quad_tree';
import { layoutText } from '@/core/text/text_batch';
import { createDemoResources } from '@/demo/resources';

// test 压测
import { disposePipes, renderPipes } from '@/business/pid_schematic/pipe_manager';

export async function runApp() {
  const canvas = document.querySelector<HTMLCanvasElement>('#canvas');
  if (!canvas) throw new Error('找不到 #canvas');

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
  // 着色器由内核自带，这里不再注入 WGSL
  await renderer.initPipeline();

  // 矩形拾取：复用渲染器的绑定布局与顶点布局（胶水在 core 的 createRendererPicker）
  const picker = await createRendererPicker(device, renderer, canvas.width, canvas.height);

  // -----------------------------------------------------------

  // ------------------ 设备图元（阀门）示例 ------------------
  // 一条「阀门—管线—阀门」链 + 拓扑：关闭阀门会把下游管线切回默认样式
  // 示例 GPU 资源：字形图集 + 阀门开关贴图
  const {
    glyphAtlas,
    titleAtlas,
    valveOffTexture: spriteTexture,
    valveOnTexture,
    valveSampler: spriteSampler,
    valveTextureWidth,
    valveTextureHeight,
  } = await createDemoResources(device);
  await initValves(
    device,
    format,
    renderer.getVertexLayout(),
    renderer.vertexBuffer,
    renderer.vertexCount,
    // 交给业务模块托管阀门拾取器（含拾取纹理与管线）
    { width: canvas.width, height: canvas.height },
  );

  // 阀门拾取器由业务模块创建并持有
  const valvePicker = getValvesPicker();
  if (!valvePicker) throw new Error('阀门拾取器未初始化（initValves 需要传入画布尺寸）');

  // -----------------------------------------------------------

  // 相机
  const camera = new Camera2d(canvas);

  // 压测初始化：生成的图元直接作为 GPU 实例绘制，并覆盖整个初始视野。
  // 场景数据（设备图元 / 管线 / 阀门链与拓扑）统一由 demo/scene 提供
  const scene = await createDemoScene(device, format);
  const { deviceTester: pidTester, pipeTester, valveScene } = scene;
  camera.scale = 0.1;

  let instanceList: RectInstance[] = [];
  let visibleItemsSnapshot: ReturnType<typeof pidTester.tick>['visibleItems'] = [];
  let visibleValves: ValveItem[] = [];

  /** 更新矩形可见集与实例缓冲；返回当前矩形实例列表（frame 阶段要在其后追加文字/贴图实例） */
  function updateVisibleInstances(): readonly RectInstance[] {
    const result = pidTester.tick(camera.getViewportAABB(), camera.isDrag);
    if (!result) return instanceList;
    visibleItemsSnapshot = result.visibleItems;

    if (!result.changed) return instanceList;

    // ✅直接调用tester提供的转换方法，自带每个item.selected状态
    instanceList = pidTester.buildRectInstanceList(visibleItemsSnapshot);
    renderer.setInstances(instanceList);
    renderer.uploadInstances();
    console.log(`视口剔除：${result.visibleItems.length} / 50000 个图元`);
    return instanceList;
  }

  updateVisibleInstances();

  // 输入与尺寸处理：点击拾取（设备优先 → 矩形）与 resize 同步
  // 画布表面：尺寸变化时统一重配上下文并重建 MSAA / 拾取纹理
  const surface = new CanvasSurface({
    canvas,
    device,
    context,
    format,
    resizeTargets: [renderer, picker, valvePicker],
  });

  bindDemoInput({
    canvas,
    context,
    device,
    format,
    camera,
    surface,
    renderer,
    picker,
    valvePicker,
    valveScene,
    getVisibleValves: () => visibleValves,
    getInstanceList: () => instanceList,
    clearSelection: () => {
      for (const item of pidTester.itemMap.values()) {
        pidTester.setItemSelected(item.id, false);
      }
    },
    selectByVisibleIndex: (index: number) => {
      const hitItem = visibleItemsSnapshot[index];
      if (!hitItem) return;
      pidTester.setItemSelected(hitItem.id, true);
      console.log('✅GPU拾取，全局图元ID：', hitItem.id, '可见数组下标', index);
    },
    refresh: updateVisibleInstances,
  });

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
    // 阀门显示走下面的贴图精灵，但拾取仍需要最新的实例数据与投影矩阵
    const valveRes = getValveResources();
    if (valveRes) {
      uploadValveInstances(
        device,
        valveRes,
        camera.getCameraProjectionMatrix(),
        visibleValves,
        camera.scale,
      );
    }
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
    // 阀门贴图精灵：@2x 资源按一半尺寸落地（64px → 32px），缩放后屏幕尺寸恒定
    const valveSpriteWorldWidth = valveTextureWidth / 2 / camera.scale;
    const valveSpriteWorldHeight = valveTextureHeight / 2 / camera.scale;
    // 按开关态分两组，贴在实例缓冲里各自连续，便于分别绑定两张贴图绘制
    const closedSprites: RectInstance[] = [];
    const openSprites: RectInstance[] = [];
    for (const valve of visibleValves) {
      const instance: RectInstance = {
        tx: valve.tx,
        ty: valve.ty,
        sx: valveSpriteWorldWidth,
        sy: valveSpriteWorldHeight,
        beta: 0,
        selected: 0,
        u0: 0,
        v0: 0,
        u1: 1,
        v1: 1,
        colorR: 1,
        colorG: 1,
        colorB: 1,
        colorA: 1,
      };
      if (valve.valveOpen > 0.5) openSprites.push(instance);
      else closedSprites.push(instance);
    }
    const spriteInstances: RectInstance[] = [...closedSprites, ...openSprites];
    const extraInstances = [...textInstances, ...spriteInstances];
    if (extraInstances.length > 0) {
      renderer.setInstances([...instanceList, ...extraInstances]);
      renderer.uploadInstances();
      // 上传完把绘制数量恢复成矩形数量：文字/贴图实例留在缓冲末尾，
      // 只由 drawTextureBatch 用自己的纹理绘制，避免被白纹理批次画成方块
      renderer.setInstances(instanceList);
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
      renderer.drawTextureBatch(
        pass,
        spriteTexture.view,
        spriteSampler,
        instanceList.length + textInstances.length,
        closedSprites.length,
      );
      // 开启态阀门用另一张贴图（同一批实例缓冲，只是换绑纹理）
      // 开启态：有独立贴图就用它，否则沿用关闭态贴图
      renderer.drawTextureBatch(
        pass,
        (valveOnTexture ?? spriteTexture).view,
        spriteSampler,
        instanceList.length + textInstances.length + closedSprites.length,
        openSprites.length,
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
