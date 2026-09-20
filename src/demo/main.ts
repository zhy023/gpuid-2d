import type { RectInstance } from '@/core/types';
import { createRendererContext } from '@/core/gpu/context';
import { createFrameRunner } from '@/demo/frame';
import { bindDemoInput } from '@/demo/input';
import { createDemoScene } from '@/demo/scene';
import { getValvesPicker, initValves, disposeValves } from '@/business/pid_schematic/valve_manager';
import type { ValveItem } from '@/business/pid_schematic/types';
import { createDemoResources } from '@/demo/resources';

// test 压测
import { disposePipes } from '@/business/pid_schematic/pipe_manager';

export async function runApp() {
  const canvas = document.querySelector<HTMLCanvasElement>('#canvas');
  if (!canvas) throw new Error('找不到 #canvas');

  // 初始化：设备/上下文/渲染器/默认拾取器/画布表面/相机（装配顺序由 core 保证）
  const { device, context, format, renderer, picker, surface, camera } =
    await createRendererContext(canvas);

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

  // 压测初始化：生成的图元直接作为 GPU 实例绘制，并覆盖整个初始视野。
  // 场景数据（设备图元 / 管线 / 阀门链与拓扑）统一由 demo/scene 提供
  const scene = await createDemoScene(device, format);
  const { deviceTester: pidTester, valveScene } = scene;
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

  // 每帧组装与提交交给 frame.ts；这里只注入运行期对象与两个回调
  const frameRunner = createFrameRunner({
    device,
    renderer,
    camera,
    scene,
    resources: {
      glyphAtlas,
      titleAtlas,
      valveOffTexture: spriteTexture,
      valveOnTexture,
      valveSampler: spriteSampler,
      valveTextureWidth,
      valveTextureHeight,
    },
    updateVisibleInstances,
    onVisibleValves: (valves) => {
      visibleValves = [...valves];
    },
  });
  frameRunner.start();

  // 页面卸载时释放 GPU 资源（纹理/buffer 必须显式销毁）
  window.addEventListener(
    'pagehide',
    () => {
      frameRunner.stop();
      renderer.dispose();
      disposePipes();
      disposeValves();
    },
    { once: true },
  );
}
