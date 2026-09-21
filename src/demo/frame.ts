/**
 * 每帧组装与提交：
 *   可见集更新（图元/管线/阀门）→ 图形组装（图元 + 文字位号 + 标题 + 阀门精灵）
 *   → 上传 → 按层序提交绘制（管线 → 阀门/位号/标题图集批次）
 *
 * 所有绘制都先建 `Graphic`（含颜色/uv/尺寸口径），再统一走 `toInstances()` 装箱，
 * 这里不手搓实例数组。
 *
 * 运行期对象通过 context 注入；这里只做「一帧的事」，不持有 demo 状态。
 */
import { renderPipes } from '@/business/pid_schematic/pipe_manager';
import { uploadValveInstances } from '@/business/pid_schematic/valve_instances';
import { getValveResources } from '@/business/pid_schematic/valve_manager';
import { PIPE_LINE_WIDTH_MAX_PX, pipeLineWidthWorld } from '@/business/pid_schematic/pipe_style';
import type { ValveGraphic } from '@/business/pid_schematic/valve_graphic';
import { toInstances } from '@/core/scene/graphic/graphic';
import { layoutText } from '@/core/text/text_batch';
import { buildValveSpriteGraphics } from '@/business/pid_schematic/valve_instances';
import { buildValveLabelGraphics } from '@/business/pid_schematic/valve_labels';
import type { Camera2d } from '@/core/camera';
import { expandAABB } from '@/core/geometry/aabb';
import type { Renderer2D } from '@/core/gpu/renderer';
import { RENDER_LAYER, sortRenderLayerDraws, type RenderLayerDraw } from '@/core/gpu/render_layer';
import type { PrimitiveInstance } from '@/core/types';
import type { DemoResources } from '@/demo/resources';
import type { DemoScene } from '@/demo/scene';

const TITLE = '你好';
/** 标题颜色（金黄，压在浅底上可辨） */
const TITLE_COLOR = [1.0, 0.78, 0.25, 1] as const;
/**
 * 示例里文字按**世界字号**排版（跟着图元一起缩放）：初始缩放 0.1
 * （1 世界单位 = 0.1 屏幕像素），位号取 120 世界单位、标题取 320，
 * 在初始视距下分别约等于 12px / 32px。
 */
const LABEL_WORLD_FONT = 120;
const TITLE_WORLD_FONT = 320;
/** demo 自己的画布背景色：淡淡的灰（引擎不兜底色，背景由 demo 决定） */
export const DEMO_CLEAR_COLOR: GPUColor = { r: 0.95, g: 0.955, b: 0.96, a: 1 };

export interface DemoFrameContext {
  device: GPUDevice;
  renderer: Renderer2D;
  camera: Camera2d;
  scene: DemoScene;
  resources: DemoResources;
  /** 更新图元可见集，返回当前基础实例列表 */
  updateVisibleInstances: () => readonly PrimitiveInstance[];
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
    const cullMargin = pipeLineWidthWorld(PIPE_LINE_WIDTH_MAX_PX) / 2;
    const cullViewport = expandAABB(camera.getViewportAABB(), cullMargin);
    return pipeTester.tick(cullViewport, camera.isDrag).visibleItems;
  }

  function visibleDemoPipes() {
    return valveScene.scene.getVisible(camera.getViewportAABB()).pipes;
  }

  /** 位号与标题的图形（每字一个 `Graphic`，图集 uv 写在图形里） */
  function buildTextGraphics(valves: readonly ValveGraphic[]) {
    // 图集按屏幕像素造字形，这里换算成「世界字号」口径：ppwu = 图集字号 / 目标世界字号
    const tagScale = glyphAtlas.fontSizePx / LABEL_WORLD_FONT;
    const titleScale = titleAtlas.fontSizePx / TITLE_WORLD_FONT;
    const titleGraphics = layoutText(titleAtlas, TITLE, {
      x: -260,
      y: -900,
      pixelsPerWorldUnit: titleScale,
      color: TITLE_COLOR,
    }).graphics;
    // 位号文案/颜色/偏移是业务表现，交给业务层
    const tagGraphics = buildValveLabelGraphics(glyphAtlas, valves, {
      pixelsPerWorldUnit: tagScale,
    });
    return { titleGraphics, tagGraphics };
  }

  /** 阀门精灵：口径（开关态分组、@2x 一半尺寸）由业务层决定，这里只装箱 */
  function buildValveSprites(valves: readonly ValveGraphic[]) {
    const { closed, open } = buildValveSpriteGraphics(valves);
    return { closed: toInstances(closed, camera.scale), open: toInstances(open, camera.scale) };
  }

  function frame() {
    if (!running) return;
    requestAnimationFrame(frame);

    const instanceList = ctx.updateVisibleInstances();
    // 视口剔除交给 PidScene（内部走 core 的四叉树），demo 不自己过滤
    const visibleValves = valveScene.scene.getVisible(camera.getViewportAABB()).valves;
    ctx.onVisibleValves(visibleValves);

    // 阀门显示走贴图精灵，但拾取仍需要最新的实例数据与投影矩阵
    const valveRes = getValveResources();
    if (valveRes) {
      uploadValveInstances(device, valveRes, camera.getCameraProjectionMatrix(), visibleValves);
    }

    const { titleGraphics, tagGraphics } = buildTextGraphics(visibleValves);
    const { closed, open } = buildValveSprites(visibleValves);
    // 装箱与排版用同一个 ppwu（文字是世界字号口径，不能再按相机缩放折算一次）
    const titleInstances = toInstances(titleGraphics, titleAtlas.fontSizePx / TITLE_WORLD_FONT);
    const tagInstances = toInstances(tagGraphics, glyphAtlas.fontSizePx / LABEL_WORLD_FONT);
    const projMat = camera.getCameraProjectionMatrix();
    renderer.uploadProjectionMatrix(projMat);

    // 整帧提交：基础实例批次 + 文字/贴图批次（打包、上传与偏移由 core 内部完成）
    renderer.renderComposite({
      instances: instanceList,
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
      // 管线最先画：设备填充、符号、位号都压在它上面（层契约见 render_layer.ts）
      drawUnderlay: (pass) => {
        const layerDraws: RenderLayerDraw[] = [
          {
            layer: RENDER_LAYER.pipe,
            // 压测管线与阀门示例管线共用一次实例化绘制
            draw: (overlayPass) =>
              renderPipes(overlayPass, projMat, [...visiblePipes(), ...visibleDemoPipes()]),
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
