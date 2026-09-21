/*
* core/shader/core_include/primitive_uniforms.wgsl
* Core 内核：通用图元的绑定约定（binding0 正交投影 UBO，binding1 实例变换 Storage）
* 与 Renderer2D 的 bindGroupLayout / WebGpuPicker 复用的 layout 严格一致
*/

#include "./instance_transform.wgsl"

struct OrthoProjectionUniform {
/*
* 2D 正交投影用 3×3 就够（z 恒定）：与 CPU 侧 composeProjection2d 同一套矩阵。
* WGSL 的 mat3x3f 每列补到 16 字节 → 48 字节，CPU 传的是 12 个 float（每列补 1 个 0）
*/
    orthoMatrix: mat3x3f,
};

@group(0) @binding(0) var<uniform> projectionUbo: OrthoProjectionUniform;
@group(0) @binding(1) var<storage, read> instanceTransformStorage: array<InstanceTransform>;
