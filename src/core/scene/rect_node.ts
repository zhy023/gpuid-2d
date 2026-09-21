/**
 * 矩形节点：节点基类的开箱实现（中心点 + 宽高 + 旋转）。
 *
 * 设备矩形、图标框、选中框这类「方块」都用它；更复杂的符号继承 `NodeGraphic` 自己算包围盒。
 */
import { NodeGraphic } from '@/core/scene/node_graphic';

export class RectNode extends NodeGraphic {
  get type(): 'rect' {
    return 'rect';
  }
}
