/**
 * 补齐 TypeScript 内置 lib.dom.d.ts 尚未收录的 WebGPU 声明。
 *
 * TypeScript 6.0 的 lib.dom 已经包含 GPUDevice、GPUCanvasContext、GPUQueue 等接口，
 * 但缺以下两部分，缺了它们引擎代码无法通过类型检查：
 *
 * 1. canvas.getContext('webgpu') 重载：目前只能命中 string 兜底重载，返回 RenderingContext
 * 2. GPU 常量对象：GPUBufferUsage / GPUShaderStage / GPUMapMode / GPUColorWrite / GPUTextureUsage
 *
 * 这里只补缺口，不重复声明 lib.dom 已有的接口。
 * 将来 TypeScript 补全这些声明后，本文件可以直接删除。
 * 如果之后想改用社区维护的 @webgpu/types，需要先确认，并同步删除本文件避免重复声明。
 */

interface HTMLCanvasElement {
  getContext(contextId: 'webgpu', options?: GPUCanvasConfiguration): GPUCanvasContext | null
}

interface OffscreenCanvas {
  getContext(contextId: 'webgpu', options?: GPUCanvasConfiguration): GPUCanvasContext | null
}

/** GPUBuffer 用途位标志，取值来自 GPUFlagsConstant */
declare var GPUBufferUsage: {
  readonly MAP_READ: GPUBufferUsageFlags
  readonly MAP_WRITE: GPUBufferUsageFlags
  readonly COPY_SRC: GPUBufferUsageFlags
  readonly COPY_DST: GPUBufferUsageFlags
  readonly INDEX: GPUBufferUsageFlags
  readonly VERTEX: GPUBufferUsageFlags
  readonly UNIFORM: GPUBufferUsageFlags
  readonly STORAGE: GPUBufferUsageFlags
  readonly INDIRECT: GPUBufferUsageFlags
  readonly QUERY_RESOLVE: GPUBufferUsageFlags
}

/** 着色器阶段可见性位标志 */
declare var GPUShaderStage: {
  readonly VERTEX: GPUShaderStageFlags
  readonly FRAGMENT: GPUShaderStageFlags
  readonly COMPUTE: GPUShaderStageFlags
}

/** GPUBuffer.mapAsync 的映射模式位标志 */
declare var GPUMapMode: {
  readonly READ: GPUMapModeFlags
  readonly WRITE: GPUMapModeFlags
}

/** 渲染通道颜色写入位标志 */
declare var GPUColorWrite: {
  readonly RED: GPUColorWriteFlags
  readonly GREEN: GPUColorWriteFlags
  readonly BLUE: GPUColorWriteFlags
  readonly ALPHA: GPUColorWriteFlags
  readonly ALL: GPUColorWriteFlags
}

/** GPUTexture 用途位标志 */
declare var GPUTextureUsage: {
  readonly COPY_SRC: GPUTextureUsageFlags
  readonly COPY_DST: GPUTextureUsageFlags
  readonly TEXTURE_BINDING: GPUTextureUsageFlags
  readonly STORAGE_BINDING: GPUTextureUsageFlags
  readonly RENDER_ATTACHMENT: GPUTextureUsageFlags
}
