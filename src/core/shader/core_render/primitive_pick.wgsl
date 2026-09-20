// Core 通用 Quad 渲染着色器

#include "@/core/shader/core_include/instance_transform.wgsl"
#include "@/core/shader/core_include/vertex_math.wgsl"
#include "@/core/shader/core_include/primitive_uniforms.wgsl"

struct PickVertexInput {
    @location(0) localPos: vec2f,
};

struct PickVertexOutput {
    @builtin(position) clipPos: vec4f,
    @location(0) @interpolate(flat) instanceId: u32,
};

@vertex
fn vertexMain(input: PickVertexInput, @builtin(instance_index) instanceIdx: u32) -> PickVertexOutput {
    var out: PickVertexOutput;
    let inst = instanceTransformStorage[instanceIdx];
    let modelMat = computeInstanceModelMatrix(inst);
    let localVec3 = vec3f(input.localPos, 1.0);
    let worldVec3 = modelMat * localVec3;
    out.clipPos = projectionUbo.orthoMatrix * vec4f(worldVec3.xy, 0.0, 1.0);
    out.instanceId = instanceIdx;
    return out;
}

@fragment
fn fragmentMain(input: PickVertexOutput) -> @location(0) vec4u {
    // 拾取编码规则：0=空白，实例ID编码为 id+1
    let encodedInstanceId = input.instanceId + 1u;
    return vec4u(encodedInstanceId, 0u, 0u, 0u);
}
