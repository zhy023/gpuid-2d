/**
 * P&ID 场景：设备图元 / 管线 / 阀门三类图元的统一增删改入口（业务语义层）。
 *
 * 空间索引、视口剔除与脏标记复用 core 的 QuadTreeStore；
 * 这里只负责「P&ID 有哪几类图元、按什么口径暴露给渲染与拾取」。
 */
import type { FlowPipe } from '@/business/pid_schematic/flow_pipe';
import type { ValveGraphic } from '@/business/pid_schematic/valve_graphic';
import type { RectNode } from '@/core/graphic/rect_node';
import { QuadTreeStore } from '@/core/graphic/quad_tree_store';
import type { AABB } from '@/core/types';

export interface PidVisibleItems {
  devices: RectNode[];
  pipes: FlowPipe[];
  valves: ValveGraphic[];
}

export class PidScene {
  readonly devices: QuadTreeStore<RectNode>;
  readonly pipes: QuadTreeStore<FlowPipe>;
  readonly valves: QuadTreeStore<ValveGraphic>;

  constructor(worldBounds: AABB) {
    this.devices = new QuadTreeStore<RectNode>(worldBounds);
    this.pipes = new QuadTreeStore<FlowPipe>(worldBounds);
    this.valves = new QuadTreeStore<ValveGraphic>(worldBounds);
  }

  /** 新增或更新设备图元（位置/尺寸/选中态变化都走这里） */
  upsertDevice(item: RectNode): void {
    this.devices.update(item);
  }

  /** 新增或更新管线（几何变更后需先 pipe.rebuildGeometry() 再调用） */
  upsertPipe(item: FlowPipe): void {
    this.pipes.update(item);
  }

  /** 新增或更新阀门 */
  upsertValve(item: ValveGraphic): void {
    this.valves.update(item);
  }

  /** 按 id 删除：三类里哪类命中就删哪类 */
  remove(id: number): void {
    this.devices.remove(id);
    this.pipes.remove(id);
    this.valves.remove(id);
  }

  /** 视口剔除：主渲染与拾取共用同一批可见集 */
  getVisible(viewport: AABB): PidVisibleItems {
    return {
      devices: this.devices.query(viewport),
      pipes: this.pipes.query(viewport),
      valves: this.valves.query(viewport),
    };
  }

  clear(): void {
    this.devices.clear();
    this.pipes.clear();
    this.valves.clear();
  }
}
