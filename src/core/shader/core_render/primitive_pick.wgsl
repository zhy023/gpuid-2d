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
    @location(1) localUv: vec2f,
    @location(2) shape: f32,
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
    return out;
}

@fragment
fn fragmentMain(input: PickVertexOutput) -> @location(0) vec4u {
    // 遮罩里的 fwidth 必须在统一控制流里求值，所以统一提到分支之前
    let localPos = input.localUv;
    let unitMask = unitSquareMask(localPos);
    let inCircle = length(localPos) * 2.0 <= 1.0;
    let inTriangle = unitTriangleMask(localPos) >= 0.5;

    // 模板三角形多出来的部分不参与拾取（与看到的单位方形一致）
    if (unitMask < 0.5) {
        return vec4u(0u, 0u, 0u, 0u);
    }
    // 形状裁剪：圆四角、三角形之外都不参与拾取，保证命中区域和看到的样子一致
    if (input.shape > 0.5 && input.shape < 1.5 && !inCircle) {
        return vec4u(0u, 0u, 0u, 0u);
    }
    if (input.shape > 1.5 && !inTriangle) {
        return vec4u(0u, 0u, 0u, 0u);
    }
    // 拾取编码规则：0=空白，实例ID编码为 id+1
    let encodedInstanceId = input.instanceId + 1u;
    return vec4u(encodedInstanceId, 0u, 0u, 0u);
}
