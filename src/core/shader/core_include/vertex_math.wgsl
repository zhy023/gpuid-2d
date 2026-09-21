// core/shader/include/vertex_math.wgsl
// Core 内核：2D矩阵工具函数，纯数学，无业务

#include "./instance_transform.wgsl"

fn mat3Scale(scaleX: f32, scaleY: f32) -> mat3x3f {
    return mat3x3f(
        vec3f(scaleX, 0.0, 0.0),
        vec3f(0.0, scaleY, 0.0),
        vec3f(0.0, 0.0, 1.0)
    );
}

fn mat3Rotate(radians: f32) -> mat3x3f {
    let cosVal = cos(radians);
    let sinVal = sin(radians);
    // 逆时针为正，与 CPU 侧 computeRotatedAABB / atan2(段方向) 约定一致
    return mat3x3f(
        vec3f(cosVal, sinVal, 0.0),
        vec3f(-sinVal, cosVal, 0.0),
        vec3f(0.0, 0.0, 1.0)
    );
}

fn mat3Translate(posX: f32, posY: f32) -> mat3x3f {
    return mat3x3f(
        vec3f(1.0, 0.0, 0.0),
        vec3f(0.0, 1.0, 0.0),
        vec3f(posX, posY, 1.0)
    );
}

fn computeInstanceModelMatrix(inst: InstanceTransform) -> mat3x3f {
    let scaleMat = mat3Scale(inst.scaleX, inst.scaleY);
    let rotateMat = mat3Rotate(inst.rotateRad);
    let translateMat = mat3Translate(inst.worldPositionX, inst.worldPositionY);
    return translateMat * rotateMat * scaleMat;
}

// 内核的顶点模板是「覆盖单位方形的三角形」（见 core/geometry/geometry.ts），
// 图形本身仍是单位方形 [-0.5, 0.5]：这里给出方形内的覆盖度（0~1）。
// 按屏幕空间一像素做抗锯齿，所以方形边缘不会出现硬锯齿。
fn unitSquareMask(localPos: vec2f) -> f32 {
    let edgeDistance = max(abs(localPos.x), abs(localPos.y));
    let pixelWidth = max(fwidth(edgeDistance), 1e-6);
    return 1.0 - smoothstep(0.5 - pixelWidth, 0.5, edgeDistance);
}
