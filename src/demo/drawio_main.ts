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
import { GlyphAtlas } from '@/core/text/glyph_atlas';
import { renderDrawioFrame } from '@/demo/drawio_frame';
import { createDrawioScene } from '@/demo/scene';

/** 位号字号（图集按字号划分，这里固定一档） */
const LABEL_FONT_SIZE_PX = 12;
/** 图纸是 drawio 页面坐标（1169×1654），初始缩放取 0.6 便于整页可见 */
const INITIAL_SCALE = 0.6;
const PAGE_WIDTH = 1169;
const PAGE_HEIGHT = 1654;

export async function runDrawioApp(): Promise<void> {
  const canvas = document.querySelector<HTMLCanvasElement>('#canvas');
  if (!canvas) throw new Error('找不到 #canvas');
  const canvasEl: HTMLCanvasElement = canvas;

  let running = true;
  let unbindResize: (() => void) | null = null;

  async function start(ctx: RendererContext) {
    const { device, renderer, camera, surface } = ctx;
    const { pidScene, labels } = await createDrawioScene();
    const labelAtlas = new GlyphAtlas(device, { fontSizePx: LABEL_FONT_SIZE_PX });

    // 视线对准图纸中心
    camera.scale = INITIAL_SCALE;
    camera.centerX = PAGE_WIDTH / 2;
    camera.centerY = PAGE_HEIGHT / 2;

    // 尺寸变化仍由内核的 CanvasSurface 统一处理
    unbindResize = surface.bindWindowResize();

    const tick = () => {
      if (!running) return;
      requestAnimationFrame(tick);
      renderDrawioFrame({ renderer, camera, scene: pidScene, labels, labelAtlas });
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
