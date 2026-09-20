// Core 通用 Quad 渲染着色器

#include "@/core/shader/core_include/instance_transform.wgsl"
#include "@/core/shader/core_include/vertex_math.wgsl"
#include "@/core/shader/core_include/primitive_uniforms.wgsl"

// 核心侧纹理能力：默认绑定 1×1 白纹理，color * texel 不改变未贴图图元的外观；
// 换成真实纹理即成实例化精灵（图集的逐实例 uv 矩形在后续加入 InstanceTransform）
@group(0) @binding(3) var atlasTexture: texture_2d<f32>;
@group(0) @binding(4) var atlasSampler: sampler;

struct VertexInput {
    @location(0) localPos: vec2f,
};

struct VertexOutput {
    @builtin(position) clipPos: vec4f,
    @location(0) localUv: vec2f,
    @location(1) isInstanceSelected: f32,
    @location(2) atlasUvRect: vec4f,
};

@vertex
fn vertexMain(input: VertexInput, @builtin(instance_index) instanceIdx: u32) -> VertexOutput {
    var out: VertexOutput;
    let inst = instanceTransformStorage[instanceIdx];
    let modelMat = computeInstanceModelMatrix(inst);

    let localVec3 = vec3f(input.localPos, 1.0);
    let worldVec3 = modelMat * localVec3;
    out.clipPos = projectionUbo.orthoMatrix * vec4f(worldVec3.xy, 0.0, 1.0);
    out.localUv = input.localPos;
    out.isInstanceSelected = inst.isSelected;
    out.atlasUvRect = inst.atlasUvRect;
    return out;
}

@fragment
fn fragmentMain(input: VertexOutput) -> @location(0) vec4f {
    var color = vec4f(0.3, 0.3, 0.3, 1.0);
    if (input.isInstanceSelected > 0.5) {
        color = mix(color, vec4f(0.95, 0.7, 0.2, 1.0), 0.35);
    }
    // 模板坐标 [-0.5,0.5] → 图集局部 uv [0,1] → 实例指定图集区域
    let localUv = input.localUv + vec2f(0.5, 0.5);
    let uv = mix(input.atlasUvRect.xy, input.atlasUvRect.zw, localUv);
    let texel = textureSample(atlasTexture, atlasSampler, uv);
    return vec4f(color.rgb * texel.rgb, color.a * texel.a);
}
