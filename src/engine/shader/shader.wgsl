struct VertexInput {
    @location(0) position: vec2f,
};

struct VertexOutput {
    @builtin(position) clipPosition: vec4f,
    @location(0) vUv: vec2f,
    @location(1) vSelected: f32,
};

// 实例数据：pad0替换为selected，总长度依然8个f32，和JS Float32Array[8]对齐
struct InstanceItem {
    sx: f32,
    sy: f32,
    beta: f32,
    tx: f32,
    ty: f32,
    selected: f32,
    pad1: f32,
    pad2: f32,
};

struct ProjectionUniform {
    projection: mat4x4f,
};

@group(0) @binding(0) var<uniform> proj: ProjectionUniform;
@group(0) @binding(1) var<storage, read> instanceBuffer: array<InstanceItem>;

fn makeScaleMatrix(sx: f32, sy: f32) -> mat3x3f {
    return mat3x3f(
        vec3f(sx, 0.0, 0.0),
        vec3f(0.0, sy, 0.0),
        vec3f(0.0, 0.0, 1.0)
    );
}

fn makeRotationMatrix(beta: f32) -> mat3x3f {
    let cosBeta = cos(beta);
    let sinBeta = sin(beta);
    return mat3x3f(
        vec3f(cosBeta, -sinBeta, 0.0),
        vec3f(sinBeta, cosBeta, 0.0),
        vec3f(0.0, 0.0, 1.0)
    );
}

fn makeTranslationMatrix(tx: f32, ty: f32) -> mat3x3f {
    return mat3x3f(
        vec3f(1.0, 0.0, 0.0),
        vec3f(0.0, 1.0, 0.0),
        vec3f(tx, ty, 1.0)
    );
}

@vertex
fn vertexMain(input: VertexInput, @builtin(instance_index) idx: u32) -> VertexOutput {
    var output: VertexOutput;
    let inst = instanceBuffer[idx];

    let scaleMatrix = makeScaleMatrix(inst.sx, inst.sy);
    let rotationMatrix = makeRotationMatrix(inst.beta);
    let translationMatrix = makeTranslationMatrix(inst.tx, inst.ty);

    let transformMatrix = translationMatrix * rotationMatrix * scaleMatrix;

    let localPosition = vec3f(input.position, 1.0);
    let worldPosition = transformMatrix * localPosition;

    output.clipPosition = proj.projection * vec4f(worldPosition.xy, 0.0, 1.0);
    output.vUv = input.position;
    output.vSelected = inst.selected;

    return output;
}

@fragment
fn fsMain(input: VertexOutput) -> @location(0) vec4f {
    // 保留你原来uv底色
    let rgb = input.vUv + 0.5;
    var outColor = vec4f(rgb.x, rgb.y, 0.4, 1.0);

    // 选中时覆盖为橙黄色高亮
    if(input.vSelected > 0.5) {
        outColor = vec4f(0.95, 0.70, 0.20, 1.0);
    }
    
    return outColor;
}
