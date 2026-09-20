/**
 * P&ID 场景：设备图元 / 管线 / 阀门三类图元的统一增删改入口（业务语义层）。
 *
 * 空间索引、视口剔除与脏标记复用 core 的 QuadTreeStore；
 * 这里只负责「P&ID 有哪几类图元、按什么口径暴露给渲染与拾取」。
 */
import type { StressTestItem } from '@/business/pid_schematic/device_stress_test';
import type { PipePolylineItem, ValveItem } from '@/business/pid_schematic/types';
import { QuadTreeStore } from '@/core/scene/quad_tree_store';
import type { AABB } from '@/core/types';

export interface PidVisibleItems {
  devices: StressTestItem[];
  pipes: PipePolylineItem[];
  valves: ValveItem[];
}

export interface PidDirtyIds {
  devices: number[];
  pipes: number[];
  valves: number[];
}

export class PidScene {
  readonly devices: QuadTreeStore<StressTestItem>;
  readonly pipes: QuadTreeStore<PipePolylineItem>;
  readonly valves: QuadTreeStore<ValveItem>;

  constructor(worldBounds: AABB) {
    this.devices = new QuadTreeStore<StressTestItem>(worldBounds);
    this.pipes = new QuadTreeStore<PipePolylineItem>(worldBounds);
    this.valves = new QuadTreeStore<ValveItem>(worldBounds);
  }

  /** 新增或更新设备图元（位置/尺寸/选中态变化都走这里） */
  upsertDevice(item: StressTestItem): void {
    this.devices.update(item);
  }

  /** 新增或更新管线（几何变更后需先 rebuildPipeGeometry 再调用） */
  upsertPipe(item: PipePolylineItem): void {
    this.pipes.update(item);
  }

  /** 新增或更新阀门 */
  upsertValve(item: ValveItem): void {
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

  /** 取出并清空脏 id（调用方据此重建实例数据） */
  takeDirty(): PidDirtyIds {
    return {
      devices: this.devices.takeDirtyIds(),
      pipes: this.pipes.takeDirtyIds(),
      valves: this.valves.takeDirtyIds(),
    };
  }

  clear(): void {
    this.devices.clear();
    this.pipes.clear();
    this.valves.clear();
  }
}
