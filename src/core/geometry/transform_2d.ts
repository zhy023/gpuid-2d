/**
 * 2D 仿射变换工具（基于 wgpu-matrix 的 mat3，自带 2D 平移/旋转/缩放）。
 *
 * 约定与 WGSL 侧 core_include/vertex_math.wgsl 完全一致：
 *   - 组合顺序 T · R · S（先缩放，再旋转，最后平移）
 *   - 逆时针为正角度
 *   - 图元模板是单位方块 [-0.5, 0.5]
 * 这样 CPU 侧的 AABB、命中检测与 GPU 侧的实际绘制不会各写一套三角函数而对不上。
 */
import { mat3, vec2 } from 'wgpu-matrix';

// 复用缓冲：这些函数每帧都会调用，避免反复 new
// 注意：wgpu-matrix 的 mat3 是 12 个元素（3×4，行尾留 1 个填充），不是 9 个
// CPU 侧用 Float64Array，避免 float32 中间量在 2 万量级世界坐标上引入毫厘级偏差
const translationMatrix = new Float64Array(12);
const rotationMatrix = new Float64Array(12);
const scaleMatrix = new Float64Array(12);
const translationVector = new Float64Array(2);
const scaleVector = new Float64Array(2);

/** CPU 侧矩阵/向量缓冲类型（wgpu-matrix 同时支持 f32 / f64） */
export type TransformBuffer = Float32Array | Float64Array;

/**
 * 组合 2D 变换矩阵 T · R · S
 * @param dst 输出矩阵（Float32Array(9)），也允许传入复用的缓冲
 */
export function composeTransform2d(
  tx: number,
  ty: number,
  beta: number,
  sx: number,
  sy: number,
  dst: TransformBuffer,
): TransformBuffer {
  mat3.translation(vec2.set(tx, ty, translationVector), translationMatrix);
  mat3.rotation(beta, rotationMatrix);
  mat3.scaling(vec2.set(sx, sy, scaleVector), scaleMatrix);
  mat3.multiply(translationMatrix, rotationMatrix, dst);
  return mat3.multiply(dst, scaleMatrix, dst);
}

/** 把点按 2D 变换矩阵变换（原地写回 dst） */
export function transformPoint2d(
  x: number,
  y: number,
  matrix: TransformBuffer,
  dst: TransformBuffer,
) {
  return vec2.transformMat3(vec2.set(x, y, dst), matrix, dst);
}
