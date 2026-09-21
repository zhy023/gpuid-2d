/*
 * core/shader/core_include/vertex_math.wgsl
 * Core 内核：2D矩阵工具函数，纯数学，无业务
 */

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

/**
 * 内核的顶点模板是「覆盖单位方形的三角形」（见 core/geometry/geometry.ts），
 * 图形本身仍是单位方形 [-0.5, 0.5]：这里给出方形内的覆盖度（0~1）。
 * 按屏幕空间一像素做抗锯齿，所以方形边缘不会出现硬锯齿。
 */
fn unitSquareMask(localPos: vec2f) -> f32 {
    let edgeDistance = max(abs(localPos.x), abs(localPos.y));
    let pixelWidth = max(fwidth(edgeDistance), 1e-6);
    return 1.0 - smoothstep(0.5 - pixelWidth, 0.5, edgeDistance);
}

/**
 * 单位方形内切三角形（底边在下、尖端在上）的覆盖度：0~1，同样按屏幕像素抗锯齿。
 * 三条边的有符号距离取最小值即「到三角形边界」的距离，再按像素宽度做平滑。
 */
fn unitTriangleMask(localPos: vec2f) -> f32 {
    let slopeScale = 0.89442718; // 1 / sqrt(1.25)：把两条斜边的距离换算成局部单位
    let leftEdge = (localPos.x + 0.5 * localPos.y + 0.25) * slopeScale;
    let rightEdge = (-localPos.x + 0.5 * localPos.y + 0.25) * slopeScale;
    let bottomEdge = 0.5 - localPos.y;
    let inside = min(min(leftEdge, rightEdge), bottomEdge);
    let pixelWidth = max(fwidth(inside), 1e-6);
    return smoothstep(-pixelWidth, pixelWidth, inside);
}

// 单位方形内切圆（宽高相等即正圆，不等就是内切椭圆）的覆盖度：0~1，按屏幕像素抗锯齿。
fn unitCircleMask(localPos: vec2f) -> f32 {
    let radius = length(localPos) * 2.0; // 0 = 中心，1 = 内切边界
    let pixelWidth = max(fwidth(radius), 1e-6);
    return 1.0 - smoothstep(1.0 - pixelWidth, 1.0, radius);
}

/**
 * 形状覆盖度：渲染拿它当 alpha，拾取用「>= 0.5」当命中判定，
 * 两条通路共用这一份，天然保证「看到什么样就能点中什么样」。
 *
 * shape 与 TS 侧 `GRAPHIC_SHAPE_*` 同口径：0 = 方框 / 1 = 圆（内切椭圆）/ 2 = 三角形（内切）。
 * 顶点模板三角形比单位方形大，所以方框遮罩是每种形状都要相交的底。
 */
fn unitShapeMask(localPos: vec2f, shape: f32) -> f32 {
    // 覆盖度里的 fwidth 必须在统一控制流里求值：三个候选先全算出来，再按 shape 取用
    let squareMask = unitSquareMask(localPos);
    let circleMask = unitCircleMask(localPos);
    let triangleMask = unitTriangleMask(localPos);

    if (shape > 1.5) {
        return min(squareMask, triangleMask);
    }

    if (shape > 0.5) {
        return min(squareMask, circleMask);
    }
    
    return squareMask;
}

/**
 * 形状编码：与 TS 侧 `GRAPHIC_SHAPE_*` 一致；描边环 = 基础形状 + 3
 * （3 = 方框环 / 4 = 圆环 / 5 = 三角环）
 */
const SHAPE_RING_OFFSET: f32 = 3.0;

/**
 * 描边环的覆盖度：外形状减去「向内缩 borderWidthPx 像素」的内形状。
 * 像素→局部单位用 fwidth 现算，所以放大缩小后描边粗细恒定（与图纸按屏幕像素给描边一致）。
 */
fn unitRingMask(localPos: vec2f, baseShape: f32, borderWidthPx: f32) -> f32 {
    let outer = unitShapeMask(localPos, baseShape);
    // 内形状：把坐标放大（等价于把形状内缩）——方框与圆/椭圆都是这样定义的，三角形近似成立
    let inset = fwidth(localPos) * max(borderWidthPx, 0.0);
    let innerPos = localPos / max(vec2f(1.0, 1.0) - 2.0 * inset, vec2f(1e-4, 1e-4));
    let inner = unitShapeMask(innerPos, baseShape);
    return max(outer - inner, 0.0);
}

/**
 * 统一入口：普通形状走覆盖度，描边环走环带覆盖度。
 * 两条路径都算完再 select——fwidth 必须待在统一控制流里，不能进分支。
 */
fn unitInstanceMask(localPos: vec2f, shape: f32, borderWidthPx: f32) -> f32 {
    let isRing = shape >= SHAPE_RING_OFFSET - 0.5;
    let baseShape = select(shape, shape - SHAPE_RING_OFFSET, isRing);
    let plainMask = unitShapeMask(localPos, baseShape);
    let ringMask = unitRingMask(localPos, baseShape, borderWidthPx);
    return select(plainMask, ringMask, isRing);
}
