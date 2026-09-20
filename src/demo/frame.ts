/**
 * 每帧组装与提交：
 *   可见集更新（矩形/管线/阀门）→ 实例组装（矩形 + 文字位号 + 标题 + 阀门精灵）
 *   → 上传 → 按层序提交绘制（管线 → 阀门/位号/标题图集批次）
 *
 * 运行期对象通过 context 注入；这里只做「一帧的事」，不持有 demo 状态。
 */
import { renderPipes } from '@/business/pid_schematic/pipe_manager';
import { uploadValveInstances } from '@/business/pid_schematic/valve_instances';
import { getValveResources } from '@/business/pid_schematic/valve_manager';
import { PIPE_LINE_WIDTH_MAX_PX, pipeLineWidthToWorld } from '@/business/pid_schematic/pipe_style';
import type { ValveItem } from '@/business/pid_schematic/types';
import { layoutText } from '@/core/text/text_batch';
import type { Camera2d } from '@/core/camera';
import { expandAABB } from '@/core/geometry/aabb';
import { QuadTree } from '@/core/geometry/quad_tree';
import type { Renderer2D } from '@/core/gpu/renderer';
import { RENDER_LAYER, sortRenderLayerDraws, type RenderLayerDraw } from '@/core/gpu/render_layer';
import type { RectInstance } from '@/core/types';
import type { DemoResources } from '@/demo/resources';
import type { DemoScene } from '@/demo/scene';

const TITLE = '你好';

export interface DemoFrameContext {
  device: GPUDevice;
  renderer: Renderer2D;
  camera: Camera2d;
  scene: DemoScene;
  resources: DemoResources;
  /** 更新矩形可见集与实例缓冲，返回当前矩形实例列表 */
  updateVisibleInstances: () => readonly RectInstance[];
  /** 每帧回写可见阀门（输入层拾取按同一数组下标解读） */
  onVisibleValves: (valves: readonly ValveItem[]) => void;
}

export interface DemoFrameRunner {
  start(): void;
  stop(): void;
}

export function createFrameRunner(ctx: DemoFrameContext): DemoFrameRunner {
  const { device, renderer, camera, scene, resources } = ctx;
  const { pipeTester, valveScene } = scene;
  const { glyphAtlas, titleAtlas, valveOffTexture, valveOnTexture, valveSampler } = resources;
  let running = false;

  /** 管线剔除视口要外扩「最粗管线的一半世界宽度」，否则贴边的管线会被提前剔掉 */
  function visiblePipes() {
    const cullMargin = pipeLineWidthToWorld(PIPE_LINE_WIDTH_MAX_PX, camera.scale) / 2;
    const cullViewport = expandAABB(camera.getViewportAABB(), cullMargin);
    return pipeTester.tick(cullViewport, camera.isDrag).visibleItems;
  }

  function visibleDemoPipes() {
    const viewport = camera.getViewportAABB();
    return valveScene.pipes.filter((pipe) => QuadTree.intersect(pipe.worldAABB, viewport));
  }

  /** 位号与标题的实例（每字一个，图集 uv 写在实例里） */
  function buildTextInstances(valves: readonly ValveItem[]) {
    const pixelsPerWorldUnit = camera.scale;
    const titleInstances = layoutText(titleAtlas, TITLE, {
      x: -260,
      y: -900,
      pixelsPerWorldUnit,
      color: [1.0, 0.78, 0.25, 1],
    }).instances;
    const tagInstances = valves.flatMap(
      (valve) =>
        layoutText(glyphAtlas, `${TITLE} ${valve.id % 1000}`, {
          x: valve.tx - 60,
          y: valve.ty + 100,
          pixelsPerWorldUnit,
          color: [0.55, 0.85, 1.0, 1],
        }).instances,
    );
    return { titleInstances, tagInstances };
  }

  /** 阀门精灵：按开关态分两组，便于分别绑定两张贴图 */
  function buildValveSprites(valves: readonly ValveItem[]) {
    // @2x 资源按一半尺寸落地，屏幕尺寸随缩放保持恒定
    const worldWidth = resources.valveTextureWidth / 2 / camera.scale;
    const worldHeight = resources.valveTextureHeight / 2 / camera.scale;
    const closed: RectInstance[] = [];
    const open: RectInstance[] = [];

    for (const valve of valves) {
      const instance: RectInstance = {
        tx: valve.tx,
        ty: valve.ty,
        sx: worldWidth,
        sy: worldHeight,
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
      if (valve.valveOpen > 0.5) open.push(instance);
      else closed.push(instance);
    }
    return { closed, open };
  }

  function frame() {
    if (!running) return;
    requestAnimationFrame(frame);

    const instanceList = ctx.updateVisibleInstances();
    const visibleValves = valveScene.valves.filter((valve) =>
      QuadTree.intersect(valve.worldAABB, camera.getViewportAABB()),
    );
    ctx.onVisibleValves(visibleValves);

    // 阀门显示走贴图精灵，但拾取仍需要最新的实例数据与投影矩阵
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

    const { titleInstances, tagInstances } = buildTextInstances(visibleValves);
    const textInstances = [...titleInstances, ...tagInstances];
    const { closed, open } = buildValveSprites(visibleValves);
    const spriteInstances = [...closed, ...open];
    const extraInstances = [...textInstances, ...spriteInstances];

    if (extraInstances.length > 0) {
      renderer.setInstances([...instanceList, ...extraInstances]);
      renderer.uploadInstances();
      // 上传完把绘制数量恢复成矩形数量：文字/贴图实例留在缓冲末尾，
      // 只由 drawTextureBatch 用自己的纹理绘制，避免被白纹理批次画成方块
      renderer.setInstances([...instanceList]);
    }

    const projMat = camera.getCameraProjectionMatrix();
    renderer.uploadProjectionMatrix(projMat);

    const layerDraws: RenderLayerDraw[] = [
      {
        layer: RENDER_LAYER.pipe,
        // 压测管线与阀门示例管线共用一次实例化绘制
        draw: (pass) =>
          renderPipes(pass, projMat, [...visiblePipes(), ...visibleDemoPipes()], camera.scale),
      },
    ];

    const textStart = instanceList.length;
    renderer.render((pass) => {
      for (const item of sortRenderLayerDraws(layerDraws)) item.draw(pass);
      // 文字与贴图各自换绑纹理，实例区间紧跟矩形批次
      renderer.drawTextureBatch(
        pass,
        titleAtlas.texture.view,
        titleAtlas.sampler,
        textStart,
        titleInstances.length,
      );
      renderer.drawTextureBatch(
        pass,
        glyphAtlas.texture.view,
        glyphAtlas.sampler,
        textStart + titleInstances.length,
        tagInstances.length,
      );
      renderer.drawTextureBatch(
        pass,
        valveOffTexture.view,
        valveSampler,
        textStart + textInstances.length,
        closed.length,
      );
      // 开启态：有独立贴图就用它，否则沿用关闭态贴图
      renderer.drawTextureBatch(
        pass,
        (valveOnTexture ?? valveOffTexture).view,
        valveSampler,
        textStart + textInstances.length + closed.length,
        open.length,
      );
    });
  }

  return {
    start() {
      if (running) return;
      running = true;
      requestAnimationFrame(frame);
    },
    stop() {
      running = false;
    },
  };
}
