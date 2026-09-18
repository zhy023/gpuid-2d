// 顶点着色器输入，局部坐标（图元自生的坐标）
struct VertexInput {
    @location(0) position: vec2f,
};

// 传给片元着色器
struct VertexOutput {
    @builtin(position) clipPosition: vec4f,
    @location(0) viewColor: vec2f,
};

struct TransformUniform {
    sx:f32, // x缩放
    sy:f32, // y缩放
    beta:f32, // 旋转角（弧度）
    tx: f32, // x平移
    ty: f32, // y平移
};

@group(0) @binding(0) var<uniform> transform: TransformUniform;

// 2维缩放矩阵变换
fn makeScaleMatrix(sx: f32, sy: f32) -> mat3x3f {
    return mat3x3f(
        vec3f(sx, 0.0, 0.0),
        vec3f(0.0, sy, 0.0),
        vec3f(0.0, 0.0, 1.0)
    );
}

// 2维旋转矩阵变换
fn makeRotationMatrix(beta: f32) -> mat3x3f {
    let cosBeta = cos(beta);
    let sinBeta = sin(beta);
    return mat3x3f(
        vec3f(cosBeta, -sinBeta, 0.0),
        vec3f(sinBeta, cosBeta, 0.0),
        vec3f(0.0, 0.0, 1.0)
    );
}

// 2维平移矩阵变换
fn makeTranslationMatrix(tx: f32, ty: f32) -> mat3x3f {
    return mat3x3f( 
        vec3f(1.0, 0.0, 0.0),
        vec3f(0.0, 1.0, 0.0),
        vec3f(tx, ty, 1.0)
    );
}

@vertex
fn vertexMain(input: VertexInput) -> VertexOutput {
    var output: VertexOutput;
    // 构造3个基础变换矩阵：缩放、旋转、平移
    // 1. 缩放  
    let scaleMatrix = makeScaleMatrix(transform.sx, transform.sy);
    // 2. 旋转
    let rotationMatrix = makeRotationMatrix(transform.beta);
    // 3. 平移
    let translationMatrix = makeTranslationMatrix(transform.tx, transform.ty);

    // 组合成一个变换矩阵
    // 4. 组合变换矩阵
    // 运算顺序：先S缩放 → R旋转 → T平移（顺序不能错）
    let transformMatrix = scaleMatrix * rotationMatrix * translationMatrix;
    
    // 5. 将局部坐标转换为齐次坐标
    let localPosition = vec3f(input.position, 1.0);

    // 6. 应用变换矩阵
    let transformedPosition = transformMatrix * localPosition;

    // 7. 输出裁剪空间坐标
    output.clipPosition = vec4f(transformedPosition.xy, 0.0, 1.0);
    
    // 8. 将局部坐标传给片元着色器
    output.viewColor = input.position;

    return output;
}


@fragment
fn fsMain(in:VertexOutput) -> @location(0) vec4f {
    return vec4f(in.viewColor, 0.0, 1.0);
}
