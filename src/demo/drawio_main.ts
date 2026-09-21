/**
 * 图纸模式入口：装载真实 draw.io 图纸并渲染（当前不含交互）。
 *
 * 与 `main.ts`（设备压测 + 阀门示例）并列，切换只需改 `app.tsx` 里的导入。
 */
import {
  createRendererContext,
  recreateRendererContext,
  type RendererContext,
} from '@/core/gpu/context';

import { renderDrawioFrame } from '@/demo/drawio_frame';
import { createDrawioScene } from '@/demo/scene';
import { DRAWIO_CLEAR_COLOR } from '@/demo/drawio_frame';
import { LabelAtlasCache } from '@/demo/label_atlases';
import { VALVE_OFF_URL, VALVE_ON_URL } from '@/demo/resources';
import { IconTextureCache } from '@/business/pid_schematic/drawio/icon_textures';
import { initPipe } from '@/business/pid_schematic/pipe_manager';
import { createTextureSampler, loadTextureFromUrl, type Texture2d } from '@/core/gpu/texture';

/** 取景留白：整页可见还留一点边 */
const VIEW_FIT_MARGIN = 0.92;

export async function runDrawioApp(): Promise<void> {
  const canvas = document.querySelector<HTMLCanvasElement>('#canvas');
  if (!canvas) throw new Error('找不到 #canvas');
  const canvasEl: HTMLCanvasElement = canvas;

  let running = true;
  let unbindResize: (() => void) | null = null;

  async function start(ctx: RendererContext) {
    const { device, format, renderer, camera, surface } = ctx;

    // 管线模块要先初始化（管线 pipeline + 三角带模板顶点），否则 renderPipes 会直接返回
    await initPipe(device, format);
    const { pidScene, labels, icons, bounds } = await createDrawioScene();
    const iconTextures = new IconTextureCache(device);
    const labelAtlases = new LabelAtlasCache(device);
    // 阀门节点贴图（开关两态）：与图纸里内联的阀门图标是同一份 PNG
    const valveOffTexture = await loadTextureFromUrl(device, VALVE_OFF_URL, 'drawio-valve-off');
    let valveOnTexture: Texture2d | null = null;
    try {
      valveOnTexture = await loadTextureFromUrl(device, VALVE_ON_URL, 'drawio-valve-on');
    } catch {
      console.warn(`[gpuid] 未找到 ${VALVE_ON_URL}，阀门开启态暂用关闭态贴图`);
    }
    const valveSampler = createTextureSampler(device, 'drawio-valve-sampler');

    // demo 自己的画布底色：引擎不再给图元兜底颜色，图纸里大量浅色/白色图元
    // 在原来的浅灰底上几乎看不见，这里换个中性偏深的底把它们衬出来
    renderer.setClearColor(DRAWIO_CLEAR_COLOR);

    // 按真实图纸范围取景：drawio 的坐标原点不一定在左上角（样例图纸 y 全是负的），
    // 写死页宽高会把整张图剔除掉，只剩画不出来的空白
    const width = Math.max(bounds.maxX - bounds.minX, 1e-6);
    const height = Math.max(bounds.maxY - bounds.minY, 1e-6);
    camera.scale = Math.min(canvasEl.width / width, canvasEl.height / height) * VIEW_FIT_MARGIN;
    camera.centerX = (bounds.minX + bounds.maxX) / 2;
    camera.centerY = (bounds.minY + bounds.maxY) / 2;

    // 尺寸变化仍由内核的 CanvasSurface 统一处理
    unbindResize = surface.bindWindowResize();

    const tick = () => {
      if (!running) return;
      requestAnimationFrame(tick);
      renderDrawioFrame({
        renderer,
        camera,
        scene: pidScene,
        labels,
        labelAtlases,
        icons,
        iconTextures,
        valveOffTexture,
        valveOnTexture,
        valveSampler,
      });
    };
    tick();
  }

  // 掉设备时按内核约定重建（重新 requestAdapter + 重新装配）
  const rebuild = async (previous?: RendererContext) => {
    const ctx = previous
      ? await recreateRendererContext(canvasEl, previous, {
          onDeviceLost: () => void rebuild(ctxRef),
        })
      : await createRendererContext(canvasEl, { onDeviceLost: () => void rebuild(ctxRef) });
    ctxRef = ctx;
    await start(ctx);
  };

  let ctxRef: RendererContext | undefined;
  await rebuild();

  window.addEventListener(
    'pagehide',
    () => {
      running = false;
      unbindResize?.();
      ctxRef?.renderer.dispose();
    },
    { once: true },
  );
}
