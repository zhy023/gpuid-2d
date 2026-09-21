// Core 通用图元拾取着色器

#include "@/core/shader/core_include/instance_transform.wgsl"
#include "@/core/shader/core_include/vertex_math.wgsl"
#include "@/core/shader/core_include/primitive_uniforms.wgsl"

struct PickVertexInput {
    @location(0) localPos: vec2f,
};

struct PickVertexOutput {
    @builtin(position) clipPos: vec4f,
    @location(0) @interpolate(flat) instanceId: u32,
    @location(1) localUv: vec2f,
    @location(2) shape: f32,
    /** 逐实例颜色的 alpha：<= 0.5 表示没指定颜色，渲染侧不会画出来 */
    @location(3) @interpolate(flat) colorAlpha: f32,
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
    out.localUv = input.localPos;
    out.shape = inst.shape;
    out.colorAlpha = inst.color.a;
    return out;
}

@fragment
fn fragmentMain(input: PickVertexOutput) -> @location(0) vec4u {
    // 覆盖度里的 fwidth 必须在统一控制流里求值，所以先整体算出来再分支
    let shapeMask = unitShapeMask(input.localUv, input.shape);
    // 没指定颜色的实例渲染侧也不会画（内核不再兜底灰色），拾取必须跟着一致
    if (input.colorAlpha <= 0.5) {
        return vec4u(0u, 0u, 0u, 0u);
    }
    // 与渲染同一份覆盖度：模板三角形多出的半边、圆四角、三角形之外都不参与拾取
    if (shapeMask < 0.5) {
        return vec4u(0u, 0u, 0u, 0u);
    }
    // 拾取编码规则：0=空白，实例ID编码为 id+1
    let encodedInstanceId = input.instanceId + 1u;
    return vec4u(encodedInstanceId, 0u, 0u, 0u);
}
