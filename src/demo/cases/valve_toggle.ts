/**
 * 功能测试：阀门开关与拓扑广播
 *
 * 验证点：阀门贴图精灵（开启/关闭两张图）、点击拾取、阀门关闭后下游管线切回默认样式。
 */
import { renderPipes } from '@/business/pid_schematic/pipe_manager';
import {
  buildValveSpriteInstances,
  uploadValveInstances,
} from '@/business/pid_schematic/valve_instances';
import { buildValveLabelInstances } from '@/business/pid_schematic/valve_labels';
import {
  getValveResources,
  getValvesPicker,
  initValves,
} from '@/business/pid_schematic/valve_manager';
import { createValveDemoScene, type ValveDemoScene } from '@/business/pid_schematic/valve_demo';
import type { ValveItem } from '@/business/pid_schematic/types';
import type { Texture2d } from '@/core/gpu/texture';
import { createTextureSampler, loadTextureFromUrl } from '@/core/gpu/texture';
import { QuadTree } from '@/core/geometry/quad_tree';
import { GlyphAtlas } from '@/core/text/glyph_atlas';
import type { DemoCase } from '@/demo/cases/types';
import { bindValvePick } from '@/demo/input';

const VALVE_OFF_URL = '/assets/famen_off@2x.png';
const VALVE_ON_URL = '/assets/famen_on@2x.png';

export function createValveToggleCase(): DemoCase {
  let valveScene: ValveDemoScene | null = null;
  let valveOff: Texture2d | null = null;
  let valveOn: Texture2d | null = null;
  let sampler: GPUSampler | null = null;
  let labelAtlas: GlyphAtlas | null = null;
  let visibleValves: ValveItem[] = [];
  let unbindInput: (() => void) | null = null;

  return {
    name: 'valve_toggle',
    description: '阀门：开启/关闭贴图、点击拾取、关闭后下游管线切回默认样式',

    async create(ctx) {
      valveScene = createValveDemoScene();
      valveOff = await loadTextureFromUrl(ctx.device, VALVE_OFF_URL, 'valve-off');
      try {
        valveOn = await loadTextureFromUrl(ctx.device, VALVE_ON_URL, 'valve-on');
      } catch {
        // 开启态贴图缺失时退化为关闭态
        valveOn = null;
      }
      sampler = createTextureSampler(ctx.device, 'valve-sampler');
      labelAtlas = new GlyphAtlas(ctx.device, { fontSizePx: 18 });

      await initValves(
        ctx.device,
        ctx.format,
        ctx.renderer.getVertexLayout(),
        ctx.renderer.vertexBuffer,
        ctx.renderer.vertexCount,
        { width: ctx.canvas.width, height: ctx.canvas.height },
      );

      // 只绑阀门拾取：命中即切换开闭并广播下游管线
      const valvePicker = getValvesPicker();
      if (valvePicker) {
        unbindInput = bindValvePick({
          canvas: ctx.canvas,
          renderer: ctx.renderer,
          valvePicker,
          valveScene,
          getVisibleValves: () => visibleValves,
        });
      }

      ctx.camera.scale = 0.25;
    },

    frame(ctx) {
      if (!valveScene || !valveOff || !sampler || !labelAtlas) return;

      const viewport = ctx.camera.getViewportAABB();
      visibleValves = valveScene.valves.filter((valve) =>
        QuadTree.intersect(valve.worldAABB, viewport),
      );
      const demoPipes = valveScene.pipes.filter((pipe) =>
        QuadTree.intersect(pipe.worldAABB, viewport),
      );

      // 阀门显示走贴图精灵，但拾取仍需要最新的实例数据与投影矩阵
      const projMat = ctx.camera.getCameraProjectionMatrix();
      const valveRes = getValveResources();
      if (valveRes) {
        uploadValveInstances(ctx.device, valveRes, projMat, visibleValves, ctx.camera.scale);
      }

      const sprites = buildValveSpriteInstances(visibleValves, {
        textureWidth: valveOff.width,
        textureHeight: valveOff.height,
        pixelsPerWorldUnit: ctx.camera.scale,
      });
      const labels = buildValveLabelInstances(labelAtlas, visibleValves, {
        pixelsPerWorldUnit: ctx.camera.scale,
        label: (valve) => `阀门 ${valve.id % 1000}`,
      });

      ctx.renderer.uploadProjectionMatrix(projMat);
      ctx.renderer.renderComposite({
        rectInstances: [],
        extraBatches: [
          { instances: labels, textureView: labelAtlas.texture.view, sampler: labelAtlas.sampler },
          { instances: sprites.closed, textureView: valveOff.view, sampler },
          { instances: sprites.open, textureView: (valveOn ?? valveOff).view, sampler },
        ],
        drawOverlay: (pass) => {
          // 阀门之间的连接管线画在设备符号之下
          renderPipes(pass, projMat, demoPipes, ctx.camera.scale);
        },
      });
    },

    dispose() {
      unbindInput?.();
      unbindInput = null;
      valveScene = null;
      valveOff = null;
      valveOn = null;
      sampler = null;
      labelAtlas = null;
      visibleValves = [];
    },
  };
}
