/**
 * 阀门图元：图形基类在 P&ID 业务里的一个实现（形状是矩形，外观由阀门着色器画）。
 *
 * 「开 / 关」用的就是图形基类的开关状态 `open`：符号由阀门着色器按它画成
 * 打开（中心挖空，透出下层管线）或关闭（红色十字封堵）；
 * 下游管线的流动样式由拓扑层（`topology.ts`）沿流向派生。
 */
import {
  SelectableGraphic,
  type SelectableGraphicOptions,
} from '@/core/scene/capability/selectable';

export interface ValveGraphicOptions<TData = unknown> extends SelectableGraphicOptions<TData> {
  /** 阀门开关状态，默认打开 */
  open?: boolean;
}

/**
 * 阀门：图形能力层（`SelectableGraphic`）的业务实现——可选中、可 hover，
 * 外加阀门自己的开关状态（业务概念，和管线的流动状态不是一回事）。
 */
export class ValveGraphic<TData = unknown> extends SelectableGraphic<TData> {
  /** 开 / 关：符号由阀门着色器按它画成打开（中心挖空）或关闭（红色十字封堵） */
  open: boolean;

  constructor(options: ValveGraphicOptions<TData>) {
    super(options);
    this.open = options.open ?? true;
  }

  /** 设置开关状态 */
  setOpen(open: boolean): this {
    if (this.open === open) return this;
    this.open = open;
    this.dirty = true;
    return this;
  }

  toggleOpen(): this {
    return this.setOpen(!this.open);
  }

  /** 实例数据口径：1 = 打开，0 = 关闭（着色器按 f32 判定） */
  get valveOpen(): number {
    return this.open ? 1 : 0;
  }
}
