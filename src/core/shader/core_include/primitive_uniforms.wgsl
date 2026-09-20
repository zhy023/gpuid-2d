// core/shader/core_include/primitive_uniforms.wgsl
// Core 内核：通用图元的绑定约定（binding0 正交投影 UBO，binding1 实例变换 Storage）
// 与 Renderer2D 的 bindGroupLayout / WebGpuPicker 复用的 layout 严格一致

#include "./instance_transform.wgsl"

struct OrthoProjectionUniform {
    orthoMatrix: mat4x4f,
};

@group(0) @binding(0) var<uniform> projectionUbo: OrthoProjectionUniform;
@group(0) @binding(1) var<storage, read> instanceTransformStorage: array<InstanceTransform>;
