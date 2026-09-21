/**
 * 图元：在绘制层（`Graphic`）之上再封一层，回答「这个图元是谁」。
 *
 * 分层口径：
 *  - `Graphic`：只管怎么画——几何、外观、状态、形状，业务无关
 *  - `DataGraphic`：目前只携带用户自定义数据 `data`。内核不解释它的结构、不写进实例、
 *    不参与绘制与拾取，只在选中图元后供使用方查看/驱动业务
 *
 * 后续跨业务的图元属性（业务 id、外部主键、元信息、标签…）加在这一层，
 * 不要往 `Graphic` 里塞，免得绘制层被业务概念污染。
 */
import { Graphic, type GraphicOptions } from '@/core/scene/graphic';

export interface DataGraphicOptions<TData = unknown> extends GraphicOptions {
  /**
   * 用户自定义数据：来源是使用方（图纸单元、后端图元记录…）。
   * 接口由使用方自己定义；这里按泛型原样携带，读的时候按需收窄。
   */
  data?: TData | null;
}

export class DataGraphic<TData = unknown> extends Graphic {
  /** 用户自定义数据：内核只负责原样携带，改它不影响渲染（不置 dirty） */
  data: TData | null;

  constructor(options: DataGraphicOptions<TData>) {
    super(options);
    this.data = options.data ?? null;
  }

  /** 挂上/替换用户自定义数据（纯数据变更，不触发重绘） */
  setData(data: TData | null): this {
    this.data = data;
    return this;
  }
}
