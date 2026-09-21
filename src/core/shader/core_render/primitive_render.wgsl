// Core 通用图元渲染着色器

#include "@/core/shader/core_include/instance_transform.wgsl"
#include "@/core/shader/core_include/vertex_math.wgsl"
#include "@/core/shader/core_include/primitive_uniforms.wgsl"

    /**
 * 核心侧纹理能力：默认绑定 1×1 白纹理，color * texel 不改变未贴图图元的外观；
 * 换成真实纹理即成实例化精灵（每实例取哪块见 InstanceTransform.atlasUvRect）
     */
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
    /** 描边宽度（屏幕像素），只有描边环用得到 */
    @location(5) borderWidthPx: f32,
};

@vertex
fn vertexMain(input: VertexInput, @builtin(instance_index) instanceIdx: u32) -> VertexOutput {
    var out: VertexOutput;
    let inst = instanceTransformStorage[instanceIdx];
    let modelMat = computeInstanceModelMatrix(inst);

    let localVec3 = vec3f(input.localPos, 1.0);
    let worldVec3 = modelMat * localVec3;
    // 3×3 正交投影：只算 xy，z 恒定 0.5
    let clip = projectionUbo.orthoMatrix * worldVec3;
    out.clipPos = vec4f(clip.xy, 0.5, 1.0);
    out.localUv = input.localPos;
    out.isInstanceSelected = inst.isSelected;
    out.atlasUvRect = inst.atlasUvRect;
    out.instanceColor = inst.color;
    out.shape = inst.shape;
    out.borderWidthPx = inst.borderWidthPx;
    return out;
}

@fragment
fn fragmentMain(input: VertexOutput) -> @location(0) vec4f {
    // 形状覆盖度（含「裁掉模板三角形多出的半边」与描边环）与拾取走同一份实现
    let shapeMask = unitInstanceMask(input.localUv, input.shape, input.borderWidthPx);

    /*
 * 遮罩为 0（模板三角形多出的半边）或没指定颜色的实例直接早退，省掉一次纹理采样；
 * 返回 (0,0,0,0) 与把 alpha 算成 0 等价：标准 alpha 混合下颜色乘 src-alpha，alpha 通道不乘
     */
    if (shapeMask <= 0.0 || input.instanceColor.a <= 0.5) {
        return vec4f(0.0, 0.0, 0.0, 0.0);
    }

    // 模板坐标 [-0.5,0.5] → 图集局部 uv [0,1] → 实例指定图集区域
    let localUv = input.localUv + vec2f(0.5, 0.5);
    let uv = mix(input.atlasUvRect.xy, input.atlasUvRect.zw, localUv);
    // 显式 LOD 0（图集只有一级 mip）：textureSampleLevel 不受「统一控制流」约束，上面才能早退
    let texel = textureSampleLevel(atlasTexture, atlasSampler, uv, 0.0);

    /**
 * 逐实例颜色是唯一的颜色来源：alpha > 0.5 才算「指定了颜色」（上面已判过，这里直接上色）；
 * 拾取着色器用同一条判据，所以看不见的图元也点不中
     */
    var rgb = input.instanceColor.rgb;
 
    if (input.isInstanceSelected > 0.5) {
        rgb = mix(rgb, vec3f(0.95, 0.7, 0.2), 0.35);
    }
 
    let alpha = input.instanceColor.a * texel.a * shapeMask;
    return vec4f(rgb * texel.rgb, alpha);
}
