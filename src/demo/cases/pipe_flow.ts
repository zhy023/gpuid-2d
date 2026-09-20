/**
 * 功能测试：管线渲染
 *
 * 验证点：每段一个实例（中点/方向角/段长）、屏幕像素粗细档位、流动条纹与默认样式两种外观。
 */
import { renderPipes } from '@/business/pid_schematic/pipe_manager';
import { PipeStressTester } from '@/business/pid_schematic/pipe_stress_test';
import { PIPE_LINE_WIDTH_MAX_PX, pipeLineWidthToWorld } from '@/business/pid_schematic/pipe_style';
import { expandAABB } from '@/core/geometry/aabb';
import { RENDER_LAYER, sortRenderLayerDraws } from '@/core/gpu/render_layer';
import type { DemoCase } from '@/demo/cases/types';
import { PIPE_COUNT, WORLD_BOUNDS } from '@/demo/scene';

export function createPipeFlowCase(): DemoCase {
  let tester: PipeStressTester | null = null;

  return {
    name: 'pipe_flow',
    description: '管线：分段实例化、像素宽度档位、流动/默认两种样式',

    async create(ctx) {
      tester = new PipeStressTester(WORLD_BOUNDS, 0.001);
      await tester.generate(PIPE_COUNT, ctx.device, ctx.format);

      // 每 4 条留一条默认（静止）样式，方便同屏对比两种外观
      let index = 0;
      for (const pipe of tester.itemMap.values()) {
        if (index % 4 === 0) pipe.flowSpeed = 0;
        index += 1;
      }
      ctx.camera.scale = 0.1;
    },

    frame(ctx) {
      if (!tester) return;

      // 剔除视口按「最粗管线的一半世界宽度」外扩，避免贴边管线被提前剔掉
      const cullMargin = pipeLineWidthToWorld(PIPE_LINE_WIDTH_MAX_PX, ctx.camera.scale) / 2;
      const viewport = expandAABB(ctx.camera.getViewportAABB(), cullMargin);
      const visiblePipes = tester.tick(viewport, ctx.camera.isDrag).visibleItems;

      const projMat = ctx.camera.getCameraProjectionMatrix();
      ctx.renderer.uploadProjectionMatrix(projMat);
      ctx.renderer.renderComposite({
        rectInstances: [],
        drawOverlay: (pass) => {
          const draws = sortRenderLayerDraws([
            {
              layer: RENDER_LAYER.pipe,
              draw: (overlayPass: GPURenderPassEncoder) =>
                renderPipes(overlayPass, projMat, visiblePipes, ctx.camera.scale),
            },
          ]);
          for (const item of draws) item.draw(pass);
        },
      });
    },

    dispose() {
      tester = null;
    },
  };
}
