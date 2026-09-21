// 图元拾取

#include "@/core/shader/core_include/instance_transform.wgsl"
#include "@/core/shader/core_include/vertex_math.wgsl"
#include "@/core/shader/core_include/primitive_uniforms.wgsl"

struct ValvePickVertexOutput {
    @builtin(position) clipPos: vec4f,
    @location(0) @interpolate(flat) instanceId: u32,
    @location(1) localPos: vec2f,
};

// 与内核模板同一套约定：一个覆盖单位方形的三角形（见 core/geometry/geometry.ts）
fn getTriangleLocalVertex(vertexIdx: u32) -> vec2f {
    const triangleVertexList = array<vec2f, 3>(
        vec2f(-0.5, -0.5),
        vec2f( 1.5, -0.5),
        vec2f(-0.5,  1.5)
    );
    return triangleVertexList[vertexIdx];
}

@vertex
fn vertexMain(@builtin(vertex_index) vertIdx: u32, @builtin(instance_index) instanceIdx: u32) -> ValvePickVertexOutput {
    var out: ValvePickVertexOutput;
    let transformData = instanceTransformStorage[instanceIdx];
    let modelMat = computeInstanceModelMatrix(transformData);
    let localPos = getTriangleLocalVertex(vertIdx);
    let localVec3 = vec3f(localPos, 1.0);
    let worldVec3 = modelMat * localVec3;
    out.clipPos = projectionUbo.orthoMatrix * vec4f(worldVec3.xy, 0.0, 1.0);
    out.instanceId = instanceIdx;
    out.localPos = localPos;
    return out;
}

@fragment
fn fragmentMain(input: ValvePickVertexOutput) -> @location(0) vec4u {
    // 单位方形之外不参与拾取
    if (unitSquareMask(input.localPos) < 0.5) {
        return vec4u(0u, 0u, 0u, 0u);
    }
    let encodedInstanceId = input.instanceId + 1u;
    return vec4u(encodedInstanceId, 0u, 0u, 0u);
}
