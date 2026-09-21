import { mat3 } from 'wgpu-matrix';
import {
  composeProjection2d,
  composeTransform2d,
  PROJECTION_FLOAT_COUNT,
  screenToWorld2d,
  transformPoint2d,
} from '@/core/geometry/transform_2d';
import type { AABB } from '@/core/types';

/**
 * hitTestRect 的复用缓冲（静态方法不能用实例字段）
 * wgpu-matrix 的 mat3 是 12 个元素（3×4，行尾留 1 个填充）
 */
const hitTestMatrix = new Float64Array(12);
const hitTestInverse = new Float64Array(12);
const hitTestPoint = new Float64Array(2);

export class Camera2d {
  public centerX: number;
  public centerY: number;
  public scale: number;
  // canvas画布像素尺寸
  public canvasWidth: number;
  public canvasHeight: number;
  public isDrag = false;

  private readonly minScale = 0.05;
  private readonly maxScale = 50;
  // 投影矩阵缓冲（mat3 + 每列补齐，直接喂 WGSL）
  private readonly projectionMatrixBuffer = new Float32Array(PROJECTION_FLOAT_COUNT);

  private lastMouseX = 0;
  private lastMouseY = 0;
  private canvas: HTMLCanvasElement;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.centerX = 0;
    this.centerY = 0;
    this.scale = 40;

    this.canvasWidth = canvas.width;
    this.canvasHeight = canvas.height;

    this.bindEvents();
  }

  /**
   * 画布尺寸更新时调用
   */
  public resize(w: number, h: number) {
    this.canvasWidth = w;
    this.canvasHeight = h;
  }

  /**
   * 屏幕像素坐标转世界坐标
   * @param pxX clientX
   * @param pxY clientY
   */
  public screenToWorld(pxX: number, pxY: number) {
    const rect = this.canvas.getBoundingClientRect();
    // 换算口径统一在 core/geometry/transform_2d.ts（屏幕 y 与世界 y 同向）
    return screenToWorld2d(
      this,
      this.canvas.width,
      this.canvas.height,
      pxX - rect.left,
      pxY - rect.top,
    );
  }

  public static hitTestRect(
    worldPt: { x: number; y: number },
    sx: number,
    sy: number,
    beta: number,
    tx: number,
    ty: number,
  ): boolean {
    /**
     * 世界点 → 图元局部空间（T·R·S 的逆矩阵），再判断是否落在单位方块 [-0.5, 0.5] 内。
     * 逆变换交给 wgpu-matrix，与 computeRotatedAABB、着色器共用同一套 2D 变换约定。
     */
    composeTransform2d(tx, ty, beta, sx, sy, hitTestMatrix);
    const inverse = mat3.invert(hitTestMatrix, hitTestInverse);
    const local = transformPoint2d(worldPt.x, worldPt.y, inverse, hitTestPoint);

    const eps = 1e-4;
    // 单位方块 [-0.5, 0.5]
    const insideX = local[0] >= -0.5 - eps && local[0] <= 0.5 + eps;
    const insideY = local[1] >= -0.5 - eps && local[1] <= 0.5 + eps;

    return insideX && insideY;
  }

  /**
   * 获取当前视口在【世界坐标】下的AABB
   */
  getViewportAABB(): AABB {
    const halfW = this.canvasWidth / 2 / this.scale;
    const halfH = this.canvasHeight / 2 / this.scale;
    return {
      minX: this.centerX - halfW,
      minY: this.centerY - halfH,
      maxX: this.centerX + halfW,
      maxY: this.centerY + halfH,
    };
  }

  // 绑定鼠标事件
  private bindEvents() {
    this.canvas.addEventListener('mousedown', (e) => {
      this.isDrag = true;
      this.lastMouseX = e.clientX;
      this.lastMouseY = e.clientY;
    });

    window.addEventListener('mousemove', (e) => {
      if (!this.isDrag) return;
      const dx = e.clientX - this.lastMouseX;
      const dy = e.clientY - this.lastMouseY;
      // 拖拽：屏幕像素差转世界偏移，除以scale
      this.centerX -= dx / this.scale;
      this.centerY -= dy / this.scale;
      this.lastMouseX = e.clientX;
      this.lastMouseY = e.clientY;
    });

    window.addEventListener('mouseup', () => {
      this.isDrag = false;
    });

    this.canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      const mouseScreenX = e.clientX;
      const mouseScreenY = e.clientY;
      const worldBefore = this.screenToWorld(mouseScreenX, mouseScreenY);

      const zoomFactor = e.deltaY > 0 ? 0.9 : 1.1;
      let newScale = this.scale * zoomFactor;
      newScale = Math.max(this.minScale, Math.min(this.maxScale, newScale));
      this.scale = newScale;

      const worldAfter = this.screenToWorld(mouseScreenX, mouseScreenY);
      this.centerX += worldBefore.x - worldAfter.x;
      this.centerY += worldBefore.y - worldAfter.y;
    });
  }

  // 获取相机投影矩阵
  public getCameraProjectionMatrix(): Float32Array {
    // 相机只出「视口中心 + 缩放」，矩阵怎么算由 transform_2d.ts 统一负责
    return composeProjection2d(
      this,
      this.canvas.width,
      this.canvas.height,
      this.projectionMatrixBuffer,
    );
  }
}
