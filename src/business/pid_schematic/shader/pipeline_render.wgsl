// 管线渲染

#include "@/core/shader/core_include/instance_transform.wgsl"
#include "@/core/shader/core_include/vertex_math.wgsl"

// 管线渲染专用UBO：正交矩阵 + 动画时间，与 updatePipeUniform/pipe_render_pass 写入布局一致
struct PidPipelineAnimationUniform {
    orthoMatrix: mat4x4<f32>,
    timeSeconds: f32,
    flowPeriodWorld: f32, // 一个流动周期对应的世界长度（= 周期像素 / 相机缩放）
    flowCyclesPerSec: f32, // 每秒走过多少个周期
    flowDashDuty: f32, // 条带在一个周期里占的比例
};

// P&ID业务数据：阀门开关 / 管线流速，与 CPU 侧 PidSchematicInstanceData 布局一致
struct PidSchematicInstanceData {
    valveOpen: f32,
    flowSpeed: f32,
    flowOffset: f32,
    pad0: f32,
};

@group(0) @binding(0) var<uniform> pipelineAnimUbo: PidPipelineAnimationUniform;
@group(0) @binding(1) var<storage, read> instanceTransformStorage: array<InstanceTransform>;
@group(0) @binding(2) var<storage, read> pidSchematicStorage: array<PidSchematicInstanceData>;

struct PipelineVertexInput {
    @location(0) localPos: vec2f,
    @location(1) flowUv: vec2f,
};

struct PipelineVertexOutput {
    @builtin(position) clipPos: vec4f,
    @location(0) flowUv: vec2f,
    @location(1) @interpolate(flat) instanceIndex: u32,
};

@vertex
fn vertexMain(input: PipelineVertexInput, @builtin(instance_index) instanceIdx: u32) -> PipelineVertexOutput {
    var out: PipelineVertexOutput;
    let transformData = instanceTransformStorage[instanceIdx];
    let modelMat = computeInstanceModelMatrix(transformData);
    let localVec3 = vec3f(input.localPos, 1.0);
    let worldVec3 = modelMat * localVec3;
    out.clipPos = pipelineAnimUbo.orthoMatrix * vec4f(worldVec3.xy, 0.0, 1.0);

    // 模板 uv.x 在段内是 0..1，这里换算成世界里程（段长取自实例矩阵第一列缩放）；
    // 配合 flowOffset（CPU 侧累计里程）让折线拐点处的流动相位连续
    let segmentLength = length(modelMat[0]);
    out.flowUv = vec2f(input.flowUv.x * segmentLength, input.flowUv.y);
    out.instanceIndex = instanceIdx;
    return out;
}

@fragment
fn fragmentMain(input: PipelineVertexOutput) -> @location(0) vec4f {
    // 绿色系配色：暗绿管身 + 亮绿流动条带 + 选中琥珀色
    const pipelineBaseColor = vec4f(0.06, 0.36, 0.17, 1.0);
    const pipelineFlowColor = vec4f(0.45, 1.0, 0.55, 1.0);
    const pipelineSelectedColor = vec4f(0.95, 0.70, 0.20, 1.0);

    // 每条管线独立流速 / 相位，来自 binding2 业务数据；
    // flowUv.x 是段内里程、flowOffset 是该段起点在整条管线上的里程（都是世界单位），相加即整条管线的里程
    let pidData = pidSchematicStorage[input.instanceIndex];
    let distanceInWorld = input.flowUv.x + pidData.flowOffset;
    let cycles =
        distanceInWorld / pipelineAnimUbo.flowPeriodWorld
        - pipelineAnimUbo.timeSeconds * pidData.flowSpeed * pipelineAnimUbo.flowCyclesPerSec;

    // 硬边矩形条带：直接用 step 切出实心长方形。
    // 管线只有 2~10px 粗，smoothstep 那种渐变边缘在细管上会糊成一片，看起来发虚。
    let band = fract(cycles);
    let isDash = band < pipelineAnimUbo.flowDashDuty;

    // 阀门关闭（flowSpeed = 0）→ 默认样式：纯管身色，不画流动条纹
    let isFlowing = pidData.flowSpeed > 0.0;
    var color = select(pipelineBaseColor, pipelineFlowColor, isFlowing && isDash);

    let transformData = instanceTransformStorage[input.instanceIndex];
    if (transformData.isSelected > 0.5) {
        color = mix(color, pipelineSelectedColor, 0.4);
    }
    return color;
}
