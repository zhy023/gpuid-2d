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
