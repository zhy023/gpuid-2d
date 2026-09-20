// 管线拾取

#include "@/core/shader/core_include/instance_transform.wgsl"
#include "@/core/shader/core_include/vertex_math.wgsl"
#include "@/core/shader/core_include/primitive_uniforms.wgsl"

struct PipelinePickVertexOutput {
    @builtin(position) clipPos: vec4f,
    @location(0) @interpolate(flat) instanceId: u32,
};

fn getQuadLocalVertex(vertexIdx: u32) -> vec2f {
    const quadVertexList = array<vec2f,6>(
        vec2f(-0.5, -0.5),
        vec2f( 0.5, -0.5),
        vec2f( 0.5,  0.5),
        vec2f(-0.5, -0.5),
        vec2f( 0.5,  0.5),
        vec2f(-0.5,  0.5)
    );
    return quadVertexList[vertexIdx];
}

@vertex
fn vertexMain(@builtin(vertex_index) vertIdx: u32, @builtin(instance_index) instanceIdx: u32) -> PipelinePickVertexOutput {
    var out: PipelinePickVertexOutput;
    let transformData = instanceTransformStorage[instanceIdx];
    let modelMat = computeInstanceModelMatrix(transformData);
    let localVec3 = vec3f(getQuadLocalVertex(vertIdx),1.0);
    let worldVec3 = modelMat * localVec3;
    out.clipPos = projectionUbo.orthoMatrix * vec4f(worldVec3.xy, 0.0, 1.0);
    out.instanceId = instanceIdx;
    return out;
}

@fragment
fn fragmentMain(input: PipelinePickVertexOutput) -> @location(0) vec4u {
    let encodedInstanceId = input.instanceId + 1u;
    return vec4u(encodedInstanceId, 0u, 0u, 0u);
}
