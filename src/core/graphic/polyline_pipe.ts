/**
 * 折线管线：管线基类的开箱实现（多段折线 + 像素粗细）。
 *
 * 工业图纸的管线、流程图的连线都属于它；业务层再按需要子类化
 * （例如 P&ID 的流动管线要额外的「静止虚线」语义）。
 */
import { PipeGraphic } from '@/core/graphic/pipe_graphic';

export class PolylinePipe extends PipeGraphic {
  get type(): 'pipeline' {
    return 'pipeline';
  }
}
