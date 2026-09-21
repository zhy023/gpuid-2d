// 图元渲染

#include "@/core/shader/core_include/instance_transform.wgsl"
#include "@/core/shader/core_include/vertex_math.wgsl"
#include "@/core/shader/core_include/primitive_uniforms.wgsl"

/**
 * P&ID业务层：图元业务数据结构，仅本feature内可见
 * 字段与 CPU 侧 PidSchematicInstanceData 一一对应（4 × f32 = 16B）
 */
struct PidSchematicInstanceData {
    valveOpen: f32, // 0.0关闭 / 1.0打开
    flowSpeed: f32, // 阀门不走流动动画，恒为 0
    flowOffset: f32,
    pad0: f32,
};

// 业务层额外StorageBuffer，binding2
@group(0) @binding(2) var<storage, read> pidSchematicBusinessStorage: array<PidSchematicInstanceData>;

struct ValveVertexInput {
    @location(0) localPos: vec2f,
};

struct ValveVertexOutput {
    @builtin(position) clipPos: vec4f,
    @location(0) localUv: vec2f,
    @location(1) isSelected: f32,
    @location(2) valveSwitch: f32,
};

@vertex
fn vertexMain(input: ValveVertexInput, @builtin(instance_index) instanceIdx: u32) -> ValveVertexOutput {
    var out: ValveVertexOutput;
    let transformData = instanceTransformStorage[instanceIdx];
    let businessData = pidSchematicBusinessStorage[instanceIdx];

    let modelMat = computeInstanceModelMatrix(transformData);
    let localVec3 = vec3f(input.localPos, 1.0);
    let worldVec3 = modelMat * localVec3;

    // 与内核同一套 3×3 正交投影
    let clip = projectionUbo.orthoMatrix * worldVec3;
    out.clipPos = vec4f(clip.xy, 0.5, 1.0);
    out.localUv = input.localPos;
    out.isSelected = transformData.isSelected;
    out.valveSwitch = businessData.valveOpen;
    return out;
}

@fragment
fn fragmentMain(input: ValveVertexOutput) -> @location(0) vec4f {
    // 遮罩里的 fwidth 必须在统一控制流里求值，所以先算好再进分支
    let unitMask = unitSquareMask(input.localUv);
    let uv = input.localUv;
    let uNorm = uv.x + 0.5;
    let vNorm = uv.y + 0.5;
    var fragColor = vec4f(0.25, 0.25, 0.25, 1.0);

    if (input.valveSwitch > 0.5) {
        // 阀门打开：中心挖空，透出下层管线
        let holeMask = 1.0
            - smoothstep(0.35, 0.45, abs(uNorm - 0.5))
            * smoothstep(0.35, 0.45, abs(vNorm - 0.5));
        if (holeMask > 0.5) {
            discard;
        }
    } else {
        // 阀门关闭：红色十字封堵
        let crossHorizontalMask = smoothstep(0.08, 0.12, abs(vNorm - 0.5));
        let crossVerticalMask = smoothstep(0.08, 0.12, abs(uNorm - 0.5));
        if (crossHorizontalMask < 0.5 || crossVerticalMask < 0.5) {
            fragColor = vec4f(0.85, 0.22, 0.22, 1.0);
        }
    }

    if (input.isSelected > 0.5) {
        fragColor = mix(fragColor, vec4f(0.95, 0.70, 0.20, 1.0), 0.35);
    }
    // 符号模板用的是内核的三角形模板，方形外的部分裁掉
    return vec4f(fragColor.rgb, fragColor.a * unitMask);
}
