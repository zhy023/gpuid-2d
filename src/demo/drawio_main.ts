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
import { LabelAtlasCache } from '@/demo/label_atlases';
import { IconTextureCache } from '@/business/pid_schematic/drawio/icon_textures';
import { initPipe } from '@/business/pid_schematic/pipe_manager';

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
