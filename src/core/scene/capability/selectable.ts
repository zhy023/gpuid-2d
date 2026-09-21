/**
 * 图形能力层：可选中 / 可取消选中（附带 hover 状态）。
 *
 * 与「管线的流动能力」（`FlowGraphic`）并列、互斥：图形有选中、没有流动状态。
 * 选中态会进实例的选中通道（着色器按 > 0.5 给选中色），所以这一层覆盖了
 * `GraphicBase` 里恒为 0 的 `selectedFlag`。
 */
import { DataGraphic, type DataGraphicOptions } from '@/core/scene/graphic/data';

export interface SelectableGraphicOptions<TData = unknown> extends DataGraphicOptions<TData> {
  /** 初始选中态，默认 false */
  selected?: boolean;
}

export class SelectableGraphic<TData = unknown> extends DataGraphic<TData> {
  /** 是否选中 */
  selected: boolean;
  /** 鼠标是否悬停（交互态，同样只属于可交互的图形） */
  hovered: boolean;

  constructor(options: SelectableGraphicOptions<TData>) {
    super(options);
    this.selected = options.selected ?? false;
    this.hovered = false;
  }

  setSelected(selected: boolean): this {
    if (this.selected === selected) return this;
    this.selected = selected;
    this.dirty = true;
    return this;
  }

  /** 取消选中（与 setSelected(false) 同义，语义化入口） */
  clearSelection(): this {
    return this.setSelected(false);
  }

  setHovered(hovered: boolean): this {
    if (this.hovered === hovered) return this;
    this.hovered = hovered;
    this.dirty = true;
    return this;
  }

  /**
   * 实例契约里选中态是 float（着色器按 > 0.5 判定）。
   * 覆盖基础层恒为 0 的实现，供打包与拾取链路读取。
   */
  override get selectedFlag(): number {
    return this.selected ? 1 : 0;
  }
}
