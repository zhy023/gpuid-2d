/**
 * 2D 变换口径的**唯一来源**（模型矩阵、正交投影、屏幕↔世界换算都在这儿）。
 *
 * 三条约定（CPU 与 GPU 必须完全一致，改动要两边一起改）：
 *   1. 组合顺序 T · R · S（先缩放，再旋转，最后平移）；图元模板是单位方块 [-0.5, 0.5]
 *   2. 角度以世界坐标的 +y 方向为正（世界 y 向下，屏幕上表现为顺时针）
 *   3. 正交投影把世界映射到 NDC：x ∈ [-1,1]，**世界 y 越大 → NDC y 越负（屏幕越往下）**
 *
 * GPU 侧的对应实现：`core/shader/core_include/vertex_math.wgsl`（模型矩阵）
 * 与 `core/shader/core_include/primitive_uniforms.wgsl`（投影 UBO，mat3x3f）。
 */
import { mat3, vec2 } from 'wgpu-matrix';

/**
 * 复用缓冲：这些函数每帧都会调用，避免反复 new
 * 注意：wgpu-matrix 的 mat3 是 12 个元素（3×4，行尾留 1 个填充），不是 9 个
 * CPU 侧用 Float64Array，避免 float32 中间量在 2 万量级世界坐标上引入毫厘级偏差
 */
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

/**
 * 2D 正交视图参数：视口中心（世界坐标）+ 每世界单位对应多少屏幕像素。
 * 相机只持有这三个量——没有单独的视图矩阵，投影矩阵每次按当前视口算。
 */
export interface OrthoView2d {
  centerX: number;
  centerY: number;
  /** 每世界单位对应多少屏幕像素 */
  scale: number;
}

/**
 * 投影矩阵在 GPU 侧的 float 数：mat3 三列各自补到 16 字节（WGSL `mat3x3f` 的列对齐），
 * 正好是 12 个 float = 48 字节的 UBO。
 */
export const PROJECTION_FLOAT_COUNT = 12;

/**
 * 生成 2D 正交投影（列主序，mat3 + 每列补 1 个 float）：
 *
 *     [ sx  0  tx ]
 *     [  0 sy  ty ]      ndc = (sx·(x-centerX), sy·(y-centerY))
 *     [  0  0   1 ]
 *
 * 其中 sx = 2/视口宽、sy = -2/视口高（负号就是"世界 y 向下"这一步）。
 */
export function composeProjection2d(
  view: OrthoView2d,
  canvasWidth: number,
  canvasHeight: number,
  dst: Float32Array = new Float32Array(PROJECTION_FLOAT_COUNT),
): Float32Array {
  const viewW = canvasWidth / view.scale;
  const viewH = canvasHeight / view.scale;
  const sx = 2 / viewW;
  const sy = -2 / viewH;

  dst[0] = sx;
  dst[1] = 0;
  dst[2] = 0;
  dst[3] = 0; /* 第一列补齐 */
  dst[4] = 0;
  dst[5] = sy;
  dst[6] = 0;
  dst[7] = 0; /* 第二列补齐 */
  dst[8] = -view.centerX * sx;
  dst[9] = -view.centerY * sy;
  dst[10] = 1;
  dst[11] = 0; /* 第三列（平移列）补齐 */
  return dst;
}

/**
 * 屏幕像素 → 世界坐标（`composeProjection2d` 的解析逆，不必真的求逆矩阵）。
 * 屏幕 y 向下、世界 y 也向下，所以两边同向。
 */
export function screenToWorld2d(
  view: OrthoView2d,
  canvasWidth: number,
  canvasHeight: number,
  pixelX: number,
  pixelY: number,
): { x: number; y: number } {
  const viewW = canvasWidth / view.scale;
  const viewH = canvasHeight / view.scale;
  const ndcX = (2 * pixelX) / canvasWidth - 1;
  const ndcY = 1 - (2 * pixelY) / canvasHeight;
  return { x: view.centerX + (ndcX * viewW) / 2, y: view.centerY - (ndcY * viewH) / 2 };
}

/** 世界坐标 → 屏幕像素（与 screenToWorld2d 互为逆运算） */
export function worldToScreen2d(
  view: OrthoView2d,
  canvasWidth: number,
  canvasHeight: number,
  worldX: number,
  worldY: number,
): { x: number; y: number } {
  const viewW = canvasWidth / view.scale;
  const viewH = canvasHeight / view.scale;
  const ndcX = ((worldX - view.centerX) * 2) / viewW;
  const ndcY = ((worldY - view.centerY) * -2) / viewH;
  return { x: ((ndcX + 1) * canvasWidth) / 2, y: ((1 - ndcY) * canvasHeight) / 2 };
}
