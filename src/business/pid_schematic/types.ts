/**
 * P&ID 业务层类型：只在这里出现管线/阀门等业务概念，引擎内核（@/core）不感知它们。
 *
 * 图元本体（设备矩形 / 流动管线 / 阀门）都是内核图形基类 `@/core/scene/graphic` 的实现：
 * 设备矩形直接用 `Graphic`，管线与阀门各自在 `flow_pipe.ts` / `valve_graphic.ts` 里扩展；
 * 这里只留 GPU 侧的数据结构与资源。
 */

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

/** 设备图元渲染资源：拾取由内核拾取器复用这套绑定，不需要业务侧再建拾取 pipeline */
export interface ValveRenderResources {
  pipeline: GPURenderPipeline;
  uniformBuffer: GPUBuffer;
  bindGroupLayout: GPUBindGroupLayout;
}
