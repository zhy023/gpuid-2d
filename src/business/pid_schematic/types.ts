/**
 * P&ID 业务层类型：只在这里出现管线/阀门等业务概念，引擎内核（@/core）不感知它们。
 */
import type { ExpandResult } from '@/core/geometry/polyline';
import type { QuadItem } from '@/core/types';

/** 管线多段线业务图元，继承通用实例图元 QuadItem */
export interface PipePolylineItem extends QuadItem {
  dirty: boolean;
  points: Array<{ x: number; y: number }>;
  /** 管线粗细：屏幕像素（2~10px，2px 步长，不随相机缩放变化） */
  lineWidthPx: number;
  geoCache: ExpandResult | null; // 膨胀几何缓存
  /** 流动动画速度倍率：>0 为流动样式（阀门打开的下游管线），0 为默认静止样式 */
  flowSpeed: number;
}

/**
 * PidSchematicInstanceData：binding‑2 storage buffer
 * 阀门开关、管线流动动画参数，与 WGSL 同名结构体严格一致（4 × f32 = 16B）
 */
export interface PidSchematicInstanceData {
  valveOpen: number;
  flowSpeed: number;
  flowOffset: number;
  pad: number;
}

/** 管线渲染资源（管线拾取不做，所以只有主渲染一条 pipeline） */
export interface PipeRenderResources {
  pipeline: GPURenderPipeline;
  uniformBuffer: GPUBuffer;
  bindGroupLayout: GPUBindGroupLayout;
}

/**
 * 阀门等设备图元：在通用实例图元之上带业务状态。
 * 符号样式由 valveOpen 驱动（打开挖空 / 关闭红叉），下游管线流动样式同样由它派生。
 */
export interface ValveItem extends QuadItem {
  type: 'valve';
  /** 1 = 打开，0 = 关闭 */
  valveOpen: number;
}

/** 设备图元渲染资源：主渲染 + 拾取两条 pipeline 共用一套绑定 */
export interface ValveRenderResources {
  pipeline: GPURenderPipeline;
  pickPipeline: GPURenderPipeline;
  uniformBuffer: GPUBuffer;
  bindGroupLayout: GPUBindGroupLayout;
}
