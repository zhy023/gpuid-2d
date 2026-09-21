/**
 * 示例入口：装配内核上下文与演示场景，并在设备丢失后自动重建。
 *
 * 复用路径：`startDemo(ctx)` 只依赖 core 的 RendererContext，
 * 因此掉设备时 `recreateRendererContext()` 拿到新上下文后可以直接再跑一遍。
 */
import { disposePipes } from '@/business/pid_schematic/pipe_manager';
import type { ValveGraphic } from '@/business/pid_schematic/valve_graphic';
import { disposeValves, getValvesPicker, initValves } from '@/business/pid_schematic/valve_manager';
import {
  createRendererContext,
  recreateRendererContext,
  type RendererContext,
} from '@/core/gpu/context';
import type { PrimitiveInstance } from '@/core/types';
import { createFrameRunner, DEMO_CLEAR_COLOR, type DemoFrameRunner } from '@/demo/frame';
import { bindDemoInput } from '@/demo/input';
import { createDemoResources } from '@/demo/resources';
import { createDemoScene } from '@/demo/scene';

/** 一次成功启动后需要持有的东西，便于重建时先停掉旧的一轮 */
interface RunningDemo {
  context: RendererContext;
  runner: DemoFrameRunner;
  unbindInput: () => void;
}

export async function runApp() {
  const canvas = document.querySelector<HTMLCanvasElement>('#canvas');
  if (!canvas) throw new Error('找不到 #canvas');
  // 嵌套的函数是声明式（会被提升），拿不到外层收窄，所以显式取一个非空引用
  const canvasEl: HTMLCanvasElement = canvas;

  let running: RunningDemo | null = null;
  let reconnecting = false;

  /**
   * 设备丢失（驱动重置、页面被回收）：释放旧链路后重建并恢复渲染，不需要刷新页面。
   * 重建必须重新 `requestAdapter()`——适配器被旧设备消费过就不能再用（见 core/gpu/context.ts）。
   */
  async function handleDeviceLost() {
    if (reconnecting) return;
    reconnecting = true;
    try {
      running?.runner.stop();
      running?.unbindInput();
      // 业务模块的 GPU 资源同样要释放，重建时由 startDemo 重新初始化
      disposePipes();
      disposeValves();

      const rebuilt = running
        ? await recreateRendererContext(canvasEl, running.context, {
            onDeviceLost: handleDeviceLost,
          })
        : await createRendererContext(canvasEl, { onDeviceLost: handleDeviceLost });

      running = await startDemo(rebuilt);
      console.log('[gpuid] 设备已重建，渲染恢复');
    } finally {
      reconnecting = false;
    }
  }

  /** 用给定上下文装配演示场景并开始渲染 */
  async function startDemo(ctx: RendererContext): Promise<RunningDemo> {
    const { device, context, format, renderer, picker, surface, camera } = ctx;

    // 示例 GPU 资源：字形图集 + 阀门开关贴图
    const resources = await createDemoResources(device);

    // 阀门拾取器由业务模块创建并持有
    await initValves(
      device,
      format,
      renderer.getVertexLayout(),
      renderer.vertexBuffer,
      renderer.vertexCount,
      { width: canvasEl.width, height: canvasEl.height },
    );
    const valvePicker = getValvesPicker();
    if (!valvePicker) throw new Error('阀门拾取器未初始化（initValves 需要传入画布尺寸）');

    // 场景数据：设备图元 / 管线 / 阀门链与拓扑
    const scene = await createDemoScene(device, format);
    const { deviceTester: pidTester, valveScene } = scene;
    camera.scale = 0.1;
    // demo 自己的画布底色（引擎不再给图元兜底颜色）
    renderer.setClearColor(DEMO_CLEAR_COLOR);

    let instanceList: PrimitiveInstance[] = [];
    let visibleItemsSnapshot: ReturnType<typeof pidTester.tick>['visibleItems'] = [];
    let visibleValves: ValveGraphic[] = [];

    /** 更新图元可见集；返回当前基础实例列表（上传与追加文字/贴图实例都在 frame 阶段做） */
    function updateVisibleInstances(): readonly PrimitiveInstance[] {
      const result = pidTester.tick(camera.getViewportAABB(), camera.isDrag);
      if (!result) return instanceList;
      visibleItemsSnapshot = result.visibleItems;

      if (!result.changed) return instanceList;

      instanceList = pidTester.buildInstanceList(visibleItemsSnapshot);
      console.log(`视口剔除：${result.visibleItems.length} / 50000 个图元`);
      return instanceList;
    }

    updateVisibleInstances();

    // 输入与尺寸处理：点击拾取（设备优先 → 基础图元）与 resize 同步
    const unbindInput = bindDemoInput({
      canvas: canvasEl,
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
    const runner = createFrameRunner({
      device,
      renderer,
      camera,
      scene,
      resources,
      updateVisibleInstances,
      onVisibleValves: (valves) => {
        visibleValves = [...valves];
      },
    });
    runner.start();

    return { context: ctx, runner, unbindInput };
  }

  running = await startDemo(
    await createRendererContext(canvas, { onDeviceLost: handleDeviceLost }),
  );

  // 页面卸载时释放 GPU 资源（纹理/buffer 必须显式销毁）
  window.addEventListener(
    'pagehide',
    () => {
      running?.runner.stop();
      running?.unbindInput();
      running?.context.renderer.dispose();
      disposePipes();
      disposeValves();
    },
    { once: true },
  );
}
