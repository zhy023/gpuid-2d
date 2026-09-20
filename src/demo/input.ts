/**
 * 输入与尺寸处理：画布点击拾取（设备图元优先 → 矩形图元）与窗口 resize 同步。
 * 运行期状态通过 context 传入，这里不持有 demo 的变量。
 */
import { getValvesBindGroup } from '@/business/pid_schematic/valve_manager';
import { toggleValve, type ValveDemoScene } from '@/business/pid_schematic/valve_demo';
import type { ValveItem } from '@/business/pid_schematic/types';
import type { Camera2d } from '@/core/camera';
import type { WebGpuPicker } from '@/core/gpu/picker';
import type { Renderer2D } from '@/core/gpu/renderer';
import type { CanvasSurface } from '@/core/gpu/surface';
import type { RectInstance } from '@/core/types';

export interface DemoInputContext {
  canvas: HTMLCanvasElement;
  context: GPUCanvasContext;
  device: GPUDevice;
  format: GPUTextureFormat;
  camera: Camera2d;
  renderer: Renderer2D;
  /** 矩形图元拾取器 */
  picker: WebGpuPicker;
  /** 设备图元拾取器 */
  valvePicker: WebGpuPicker;
  valveScene: ValveDemoScene;
  /** 画布表面：尺寸变化时统一重配上下文并重建内部纹理 */
  surface: CanvasSurface;
  /** 当前帧可见设备图元（拾取下标 = 数组下标） */
  getVisibleValves: () => readonly ValveItem[];
  /** 当前帧矩形实例（数量用于限制拾取范围） */
  getInstanceList: () => readonly RectInstance[];
  /** 命中可见数组下标后的选中处理 */
  selectByVisibleIndex: (index: number) => void;
  /** 清空全部选择 */
  clearSelection: () => void;
  /** 选中态变化后刷新实例缓冲 */
  refresh: () => void;
}

export interface ValvePickBinding {
  canvas: HTMLCanvasElement;
  renderer: Renderer2D;
  valvePicker: WebGpuPicker;
  valveScene: ValveDemoScene;
  /** 当前帧可见阀门（拾取下标 = 数组下标） */
  getVisibleValves: () => readonly ValveItem[];
  /** 命中并切换后的回调；不传则打印状态 */
  onToggled?: (valve: ValveItem) => void;
}

/**
 * 只绑定「设备图元（阀门）拾取」：命中即切换开闭并广播下游管线样式。
 * 功能测试（demo/cases）只关心阀门交互时用它；全量演示用 bindDemoInput（设备优先 → 矩形）。
 * @returns 解绑函数
 */
export function bindValvePick(options: ValvePickBinding): () => void {
  const { canvas, renderer, valvePicker, valveScene, getVisibleValves, onToggled } = options;

  async function onMouseDown(event: MouseEvent) {
    event.stopPropagation();

    const valveBindGroup = getValvesBindGroup();
    if (!valveBindGroup) return;

    const visibleValves = getVisibleValves();
    const hitIndex = await valvePicker.pickAt(
      canvas,
      event.clientX,
      event.clientY,
      valveBindGroup,
      renderer.vertexBuffer,
      renderer.vertexCount,
      visibleValves.length,
    );
    const hitValve = hitIndex === null ? undefined : visibleValves[hitIndex];
    const toggled = hitValve ? toggleValve(valveScene, hitValve.id) : null;
    if (!toggled) return;

    if (onToggled) {
      onToggled(toggled);
    } else {
      console.log(
        `阀门 ${toggled.id}：${
          toggled.valveOpen > 0.5 ? '打开（下游恢复流动）' : '关闭（下游恢复默认样式）'
        }`,
      );
    }
  }

  canvas.addEventListener('mousedown', onMouseDown);
  return () => canvas.removeEventListener('mousedown', onMouseDown);
}

/** 绑定画布点击与窗口 resize；返回解绑函数 */
export function bindDemoInput(ctx: DemoInputContext): () => void {
  const { canvas, renderer, picker, valvePicker, valveScene } = ctx;

  async function onMouseDown(event: MouseEvent) {
    event.stopPropagation();

    // 设备图元优先：阀门符号压在管线之上，命中就切换开闭并广播下游管线
    const valveBindGroup = getValvesBindGroup();
    const visibleValves = ctx.getVisibleValves();
    if (valveBindGroup) {
      // 屏幕坐标 → 画布像素由 picker 内部换算
      const hitValveIndex = await valvePicker.pickAt(
        canvas,
        event.clientX,
        event.clientY,
        valveBindGroup,
        renderer.vertexBuffer,
        renderer.vertexCount,
        visibleValves.length,
      );
      const hitValve = hitValveIndex === null ? undefined : visibleValves[hitValveIndex];
      const toggled = hitValve ? toggleValve(valveScene, hitValve.id) : null;
      if (toggled) {
        console.log(
          `阀门 ${toggled.id}：${
            toggled.valveOpen > 0.5 ? '打开（下游恢复流动）' : '关闭（下游恢复默认样式）'
          }`,
        );
        return;
      }
    }

    // 矩形图元拾取：先把全部选中清掉，再按命中下标选中
    const hitIndex = await picker.pickAt(
      canvas,
      event.clientX,
      event.clientY,
      renderer.bindGroup,
      renderer.vertexBuffer,
      renderer.vertexCount,
      ctx.getInstanceList().length,
    );
    ctx.clearSelection();

    if (hitIndex === null) {
      console.log('❌空白，未选中图形');
    } else {
      ctx.selectByVisibleIndex(hitIndex);
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
