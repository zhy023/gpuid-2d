/**
 * 图纸模式的输入：点击阀门节点切换选中（selectable 能力），并把选中的图元 id 打出来。
 *
 * 拾取本身都在 core（`pickAt` 换算、`pickFirst` 按候选顺序试到命中）；
 * 这里只声明「点谁、点中之后做什么」。
 */
import { getValvesBindGroup, getValvesPicker } from '@/business/pid_schematic/valve_manager';
import { isDrawioCellData } from '@/business/pid_schematic/drawio/to_pid_scene';
import type { PidScene } from '@/business/pid_schematic/pid_scene';
import { applyValveFlowState, type Topology } from '@/business/pid_schematic/topology';
import type { ValveGraphic } from '@/business/pid_schematic/valve_graphic';
import { pickFirst, type PickCandidate } from '@/core/gpu/picker';
import type { Renderer2D } from '@/core/gpu/renderer';

export interface DrawioInputContext {
  canvas: HTMLCanvasElement;
  renderer: Renderer2D;
  /** 当前帧可见阀门（拾取下标 = 数组下标）；与上传给拾取器的实例同序 */
  getVisibleValves: () => readonly ValveGraphic[];
  /** 清空全部阀门的选中态（单选：换选之前先清干净，含视口外的） */
  clearSelection: () => void;
  /** 图纸场景（开关阀门后按拓扑把下游管线切样式） */
  scene: PidScene;
  /** 管线 → 两端设备的拓扑（方向 = 图纸里边的 source → target） */
  topology: Topology;
}

/** 绑定画布点击；返回解绑函数 */
export function bindDrawioInput(ctx: DrawioInputContext): () => void {
  const { canvas, renderer } = ctx;

  async function onMouseDown(event: MouseEvent): Promise<void> {
    const picker = getValvesPicker();
    const bindGroup = getValvesBindGroup();
    const valves = ctx.getVisibleValves();
    if (!picker || !bindGroup || valves.length === 0) return;

    const candidates: PickCandidate[] = [
      {
        picker,
        bindGroup,
        vertexBuffer: renderer.vertexBuffer,
        vertexCount: renderer.vertexCount,
        instanceCount: valves.length,
        label: 'valve',
      },
    ];
    const hit = await pickFirst(canvas, event.clientX, event.clientY, candidates);
    if (!hit) {
      ctx.clearSelection();
      console.log('❌ 空白，已清空阀门选中');
      return;
    }

    // 阀门节点是可选中图元（selectable 能力）：一次只允许选中一个——
    // 点未选中的阀门 = 清掉其它再选中它；点已选中的阀门 = 取消选中
    const valve = valves[hit.index];
    if (!valve) return;
    const nextSelected = !valve.selected;
    ctx.clearSelection();
    valve.setSelected(nextSelected);

    const cell = isDrawioCellData(valve.data) ? valve.data : null;
    console.log(
      `✅ ${nextSelected ? '选中' : '取消选中'}阀门 id=${valve.id} state=${
        valve.open ? '开' : '关'
      }${cell ? ` cell=${cell.cellId} label=${cell.label || '(无)'}` : ''}`,
    );
  }

  canvas.addEventListener('mousedown', onMouseDown);

  /** 双击阀门：开 / 关，并按拓扑把下游管线切到对应样式（方向：source → target） */
  async function onDoubleClick(event: MouseEvent): Promise<void> {
    const picker = getValvesPicker();
    const bindGroup = getValvesBindGroup();
    const valves = ctx.getVisibleValves();
    if (!picker || !bindGroup || valves.length === 0) return;

    const hit = await pickFirst(canvas, event.clientX, event.clientY, [
      {
        picker,
        bindGroup,
        vertexBuffer: renderer.vertexBuffer,
        vertexCount: renderer.vertexCount,
        instanceCount: valves.length,
        label: 'valve',
      },
    ]);
    if (!hit) return;
    const valve = valves[hit.index];
    if (!valve) return;

    valve.toggleOpen();
    applyValveFlowState(ctx.topology, ctx.scene.valves.values(), ctx.scene.pipes);
    console.log(
      `🔁 阀门 id=${valve.id} 已${valve.open ? '打开' : '关闭'}（下游管线按 source → target 跟随）`,
    );
  }

  canvas.addEventListener('dblclick', onDoubleClick);
  return () => {
    canvas.removeEventListener('mousedown', onMouseDown);
    canvas.removeEventListener('dblclick', onDoubleClick);
  };
}
