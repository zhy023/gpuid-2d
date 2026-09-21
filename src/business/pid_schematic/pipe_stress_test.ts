import { createFlowPipe, type FlowPipe } from '@/business/pid_schematic/flow_pipe';
import { initPipe } from '@/business/pid_schematic/pipe_manager';
import { PIPE_LINE_WIDTH_STEPS } from '@/business/pid_schematic/pipe_style';
import { PidScene } from '@/business/pid_schematic/pid_scene';
import type { Point } from '@/core/geometry/polyline';
import type { AABB } from '@/core/types';

export type PipeTestItem = FlowPipe;

export class PipeStressTester {
  public readonly itemMap = new Map<number, PipeTestItem>();
  /** 空间索引走 PidScene；本类只维护「哪些管线需要重建几何」 */
  public readonly scene: PidScene;
  public worldBounds: AABB;
  public moveRatio: number;

  private prevVisibleItems: PipeTestItem[] = [];
  private prevSize = 0;
  private pipeInitialized = false;

  constructor(worldBounds: AABB, moveRatio = 0.001) {
    this.worldBounds = worldBounds;
    this.scene = new PidScene(worldBounds);
    this.moveRatio = moveRatio;
  }

  async generate(count: number, device: GPUDevice, canvasFormat: GPUTextureFormat) {
    if (!this.pipeInitialized) {
      await initPipe(device, canvasFormat);
      this.pipeInitialized = true;
    }

    const w = this.worldBounds.maxX - this.worldBounds.minX;
    const h = this.worldBounds.maxY - this.worldBounds.minY;

    this.itemMap.clear();
    this.scene.clear();

    // 起点内缩，保证整条直角折线（含最长走线）仍落在世界范围内，不会被四叉树丢弃
    const margin = 2000;

    for (let i = 0; i < count; i++) {
      const startX = this.worldBounds.minX + margin + Math.random() * (w - margin * 2);
      const startY = this.worldBounds.minY + margin + Math.random() * (h - margin * 2);

      // P&ID 管线就是两点之间的一条直线段：横平竖直，没有斜线和其他形状
      const runLength = 200 + Math.random() * 600;
      const direction = Math.random() < 0.5 ? -1 : 1;
      const points: Point[] =
        Math.random() < 0.5
          ? [
              { x: startX, y: startY },
              { x: startX + direction * runLength, y: startY },
            ]
          : [
              { x: startX, y: startY },
              { x: startX, y: startY + direction * runLength },
            ];
      // 管线粗细是屏幕像素档位：2 / 4 / 6 / 8 / 10
      const lineWidthPx =
        PIPE_LINE_WIDTH_STEPS[Math.floor(Math.random() * PIPE_LINE_WIDTH_STEPS.length)];

      const pipeItem = createFlowPipe(i, points, lineWidthPx);
      // 管线之间只有粗细不同：颜色、条纹、流速全部一致（打开 = 流动动画）
      pipeItem.setOpen(true);
      pipeItem.clearDirty();

      this.itemMap.set(i, pipeItem);
      this.scene.upsertPipe(pipeItem);
    }

    console.log(`✅ PipeStressTester: 生成 ${count} 根测试管线`);
  }

  tick(viewport: AABB, isDrag = false) {
    let geometryChanged = false;
    if (!isDrag) {
      // 非拖动：随机扰动管线顶点
      for (const item of this.itemMap.values()) {
        if (Math.random() < this.moveRatio) {
          for (const pt of item.points) {
            pt.x += (Math.random() - 0.5) * 6;
            pt.y += (Math.random() - 0.5) * 6;
          }
          // 几何变了：让包围盒失效（顶点是原地改的，显式通知一次）并更新索引
          item.markGeometryDirty();
          this.scene.upsertPipe(item);
          item.clearDirty();
          geometryChanged = true;
        }
      }
    }

    // 视口剔除：索引层已按 AABB 相交过滤
    const visibleItems = this.scene.getVisible(viewport).pipes;

    let changed = geometryChanged;
    if (visibleItems.length !== this.prevSize) {
      changed = true;
    } else {
      const oldFirst = this.prevVisibleItems[0];
      const newFirst = visibleItems[0];
      const oldLast = this.prevVisibleItems.at(-1);
      const newLast = visibleItems.at(-1);
      if (oldFirst?.id !== newFirst?.id || oldLast?.id !== newLast?.id) {
        changed = true;
      }
    }

    if (changed) {
      this.prevVisibleItems = visibleItems;
      this.prevSize = visibleItems.length;
    }

    return { changed, visibleItems };
  }

  destroy() {
    this.itemMap.clear();
    this.prevVisibleItems = [];
    this.prevSize = 0;
    this.scene.clear();
  }
}
