/**
 * 阀门图元：节点基类在 P&ID 业务里的一个实现。
 *
 * 「开 / 关」用的就是节点基类的开关状态 `open`：符号由阀门着色器按它画成
 * 打开（中心挖空，透出下层管线）或关闭（红色十字封堵）；
 * 下游管线的流动样式由拓扑层（`topology.ts`）沿流向派生。
 */
import { NodeGraphic } from '@/core/scene/node_graphic';

export class ValveGraphic extends NodeGraphic {
  get type(): 'valve' {
    return 'valve';
  }

  /** 实例数据口径：1 = 打开，0 = 关闭（着色器按 f32 判定） */
  get valveOpen(): number {
    return this.open ? 1 : 0;
  }
}
