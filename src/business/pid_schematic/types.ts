/**
 * P&ID 业务层类型：只在这里出现管线/阀门等业务概念，引擎内核（@/core）不感知它们。
 *
 * 图元本体（设备矩形 / 流动管线 / 阀门）现在是内核图形基类的实现类：
 * `@/core/graphic/rect_node`、`@/business/pid_schematic/flow_pipe`、
 * `@/business/pid_schematic/valve_graphic`；这里只留 GPU 侧的数据结构与资源。
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

/** 设备图元渲染资源：主渲染 + 拾取两条 pipeline 共用一套绑定 */
export interface ValveRenderResources {
  pipeline: GPURenderPipeline;
  pickPipeline: GPURenderPipeline;
  uniformBuffer: GPUBuffer;
  bindGroupLayout: GPUBindGroupLayout;
}
