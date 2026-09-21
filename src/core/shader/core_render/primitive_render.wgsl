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
    @location(3) instanceColor: vec4f,
    @location(4) shape: f32,
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
    out.instanceColor = inst.color;
    out.shape = inst.shape;
    return out;
}

@fragment
fn fragmentMain(input: VertexOutput) -> @location(0) vec4f {
    // 形状覆盖度（含「裁掉模板三角形多出的半边」）与拾取走同一份实现
    let shapeMask = unitShapeMask(input.localUv, input.shape);

    var color = vec4f(0.3, 0.3, 0.3, 1.0);
    if (input.isInstanceSelected > 0.5) {
        color = mix(color, vec4f(0.95, 0.7, 0.2, 1.0), 0.35);
    }
    // 模板坐标 [-0.5,0.5] → 图集局部 uv [0,1] → 实例指定图集区域
    let localUv = input.localUv + vec2f(0.5, 0.5);
    let uv = mix(input.atlasUvRect.xy, input.atlasUvRect.zw, localUv);
    let texel = textureSample(atlasTexture, atlasSampler, uv);
    // 逐实例颜色：alpha > 0.5 表示该实例显式指定颜色（文字/位号），否则用默认灰/选中色
    let hasInstanceColor = input.instanceColor.a > 0.5;
    let rgb = select(color.rgb, input.instanceColor.rgb, hasInstanceColor);
    let alpha = color.a * texel.a * select(1.0, input.instanceColor.a, hasInstanceColor);
    return vec4f(rgb * texel.rgb, alpha * shapeMask);
}
