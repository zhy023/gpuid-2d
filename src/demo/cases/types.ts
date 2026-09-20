/**
 * 功能测试（demo case）契约。
 *
 * demo 目录的定位是「按能力拆分、可单独运行的功能测试」：
 * 每个 case 只声明自己要什么资源、每帧做什么，组装与循环由 main.ts 负责。
 * 通用机制一律放 core（渲染批次、拾取、贴图加载、文字排版…），case 里只写「这次要验证什么」。
 */
import type { Camera2d } from '@/core/camera';
import type { Renderer2D } from '@/core/gpu/renderer';
import type { CanvasSurface } from '@/core/gpu/surface';
import type { RectInstance } from '@/core/types';

/** 由 main 注入的运行期上下文：所有 case 共用同一套内核对象 */
export interface DemoCaseContext {
  device: GPUDevice;
  canvas: HTMLCanvasElement;
  format: GPUTextureFormat;
  renderer: Renderer2D;
  camera: Camera2d;
  /** 画布表面；暂未需要 resize 处理的 case 可以不依赖它 */
  surface?: CanvasSurface;
  /** 画布尺寸变化时由 case 决定是否需要重建自己的资源 */
  onResize?(width: number, height: number): void;
}

export interface DemoCase {
  /** 用例名，对应 URL 的 ?case=<name> */
  name: string;
  /** 说明：这个功能测试验证什么 */
  description: string;
  /** 创建用例资源与数据（可能异步） */
  create(ctx: DemoCaseContext): Promise<void> | void;
  /**
   * 每帧：更新可见集与实例，并提交绘制。
   * 实现里通常调用 core 的 renderer.renderComposite()。
   */
  frame?(ctx: DemoCaseContext): void;
  /** 释放本用例持有的 GPU 资源 */
  dispose?(): void;
}

/** case 之间共享的小工具：把实例列表转成数组（避免只读类型在拼接时别扭） */
export type CaseInstanceList = readonly RectInstance[];
