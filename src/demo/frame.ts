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
import type { ValveGraphic } from '@/business/pid_schematic/valve_graphic';
import { layoutText } from '@/core/text/text_batch';
import { buildValveSpriteInstances } from '@/business/pid_schematic/valve_instances';
import { buildValveLabelInstances } from '@/business/pid_schematic/valve_labels';
import type { Camera2d } from '@/core/camera';
import { expandAABB } from '@/core/geometry/aabb';
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
  onVisibleValves: (valves: readonly ValveGraphic[]) => void;
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
    return valveScene.scene.getVisible(camera.getViewportAABB()).pipes;
  }

  /** 位号与标题的实例（每字一个，图集 uv 写在实例里） */
  function buildTextInstances(valves: readonly ValveGraphic[]) {
    const pixelsPerWorldUnit = camera.scale;
    const titleInstances = layoutText(titleAtlas, TITLE, {
      x: -260,
      y: -900,
      pixelsPerWorldUnit,
      color: [1.0, 0.78, 0.25, 1],
    }).instances;
    // 位号文案/颜色/偏移是业务表现，交给业务层
    const tagInstances = buildValveLabelInstances(glyphAtlas, valves, { pixelsPerWorldUnit });
    return { titleInstances, tagInstances };
  }

  /** 阀门精灵：口径（开关态分组、@2x 一半尺寸）由业务层决定 */
  function buildValveSprites(valves: readonly ValveGraphic[]) {
    return buildValveSpriteInstances(valves, {
      textureWidth: resources.valveTextureWidth,
      textureHeight: resources.valveTextureHeight,
      pixelsPerWorldUnit: camera.scale,
    });
  }

  function frame() {
    if (!running) return;
    requestAnimationFrame(frame);

    const instanceList = ctx.updateVisibleInstances();
    // 视口剔除交给 PidScene（内部走 core 的四叉树），demo 不再自己过滤
    const visibleValves = valveScene.scene.getVisible(camera.getViewportAABB()).valves;
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
    const { closed, open } = buildValveSprites(visibleValves);
    const projMat = camera.getCameraProjectionMatrix();
    renderer.uploadProjectionMatrix(projMat);

    // 整帧提交：基础矩形批次 + 文字/贴图批次（拼接与偏移由 core 内部完成）
    renderer.renderComposite({
      rectInstances: instanceList,
      extraBatches: [
        {
          instances: titleInstances,
          textureView: titleAtlas.texture.view,
          sampler: titleAtlas.sampler,
        },
        {
          instances: tagInstances,
          textureView: glyphAtlas.texture.view,
          sampler: glyphAtlas.sampler,
        },
        { instances: closed, textureView: valveOffTexture.view, sampler: valveSampler },
        {
          // 开启态：有独立贴图就用它，否则沿用关闭态贴图
          instances: open,
          textureView: (valveOnTexture ?? valveOffTexture).view,
          sampler: valveSampler,
        },
      ],
      drawOverlay: (pass) => {
        const layerDraws: RenderLayerDraw[] = [
          {
            layer: RENDER_LAYER.pipe,
            // 压测管线与阀门示例管线共用一次实例化绘制
            draw: (overlayPass) =>
              renderPipes(
                overlayPass,
                projMat,
                [...visiblePipes(), ...visibleDemoPipes()],
                camera.scale,
              ),
          },
        ];
        for (const item of sortRenderLayerDraws(layerDraws)) item.draw(pass);
      },
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
