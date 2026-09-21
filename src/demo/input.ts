/**
 * 输入与尺寸处理：画布点击拾取（设备图元优先 → 通用图元）与窗口 resize 同步。
 *
 * 拾取机制都在 core（屏幕坐标换算 `pickAt`、按候选顺序试到命中 `pickFirst`），
 * 这里只声明「优先级顺序」与「命中后的业务动作」。
 */
import type { ValveGraphic } from '@/business/pid_schematic/valve_graphic';
import { toggleValve, type ValveDemoScene } from '@/business/pid_schematic/valve_demo';
import { getValvesBindGroup } from '@/business/pid_schematic/valve_manager';
import type { Camera2d } from '@/core/camera';
import { pickFirst, type PickCandidate, type WebGpuPicker } from '@/core/gpu/picker';
import type { Renderer2D } from '@/core/gpu/renderer';
import type { CanvasSurface } from '@/core/gpu/surface';
import type { PrimitiveInstance } from '@/core/types';

export interface DemoInputContext {
  canvas: HTMLCanvasElement;
  context: GPUCanvasContext;
  device: GPUDevice;
  format: GPUTextureFormat;
  camera: Camera2d;
  renderer: Renderer2D;
  /** 基础图元拾取器 */
  picker: WebGpuPicker;
  /** 设备图元拾取器 */
  valvePicker: WebGpuPicker;
  valveScene: ValveDemoScene;
  /** 画布表面：尺寸变化时统一重配上下文并重建内部纹理 */
  surface: CanvasSurface;
  /** 当前帧可见设备图元（拾取下标 = 数组下标） */
  getVisibleValves: () => readonly ValveGraphic[];
  /** 当前帧基础实例（数量用于限制拾取范围） */
  getInstanceList: () => readonly PrimitiveInstance[];
  /** 命中可见数组下标后的选中处理 */
  selectByVisibleIndex: (index: number) => void;
  /** 清空全部选择 */
  clearSelection: () => void;
  /** 选中态变化后刷新实例缓冲 */
  refresh: () => void;
}

const VALVE_LABEL = 'valve';
const PRIMITIVE_LABEL = 'primitive';

/** 绑定画布点击与窗口 resize；返回解绑函数 */
export function bindDemoInput(ctx: DemoInputContext): () => void {
  const { canvas, renderer, picker, valvePicker, valveScene } = ctx;

  /** 候选顺序即拾取优先级：设备符号压在管线与图元之上 */
  function buildCandidates(): PickCandidate[] {
    const candidates: PickCandidate[] = [];
    const valveBindGroup = getValvesBindGroup();

    if (valveBindGroup) {
      candidates.push({
        picker: valvePicker,
        bindGroup: valveBindGroup,
        vertexBuffer: renderer.vertexBuffer,
        vertexCount: renderer.vertexCount,
        instanceCount: ctx.getVisibleValves().length,
        label: VALVE_LABEL,
      });
    }
    candidates.push({
      picker,
      bindGroup: renderer.bindGroup,
      vertexBuffer: renderer.vertexBuffer,
      vertexCount: renderer.vertexCount,
      instanceCount: ctx.getInstanceList().length,
      label: PRIMITIVE_LABEL,
    });

    return candidates;
  }

  async function onMouseDown(event: MouseEvent) {
    event.stopPropagation();

    const visibleValves = ctx.getVisibleValves();
    const hit = await pickFirst(canvas, event.clientX, event.clientY, buildCandidates());

    // 设备图元命中：切换开闭并广播下游管线样式
    if (hit?.candidate.label === VALVE_LABEL) {
      const hitValve = visibleValves[hit.index];
      if (!hitValve) return;

      const toggled = toggleValve(valveScene, hitValve.id);
      if (!toggled) return;
      // 图元自带的用户数据（图纸单元信息等）：有就一并打出来
      const detail = hitValve.data ? `，数据：${JSON.stringify(hitValve.data)}` : '';
      console.log(
        `阀门 ${toggled.id}：${toggled.open ? '打开（下游恢复流动）' : '关闭（下游恢复默认样式）'}${detail}`,
      );
      return;
    }

    // 基础图元：先清空全部选中，再按命中下标选中
    ctx.clearSelection();
    if (!hit) {
      console.log('❌空白，未选中图形');
    } else {
      ctx.selectByVisibleIndex(hit.index);
    }
    ctx.refresh();
  }

  canvas.addEventListener('mousedown', onMouseDown);
  // 尺寸变化交由内核的 CanvasSurface 统一处理（上下文重配 + MSAA/拾取纹理重建）
  const unbindResize = ctx.surface.bindWindowResize();

  return () => {
    canvas.removeEventListener('mousedown', onMouseDown);
    unbindResize();
  };
}
