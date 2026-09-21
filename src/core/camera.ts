import { mat3, mat4, vec4 } from 'wgpu-matrix';
import { composeTransform2d, transformPoint2d } from '@/core/geometry/transform_2d';
import type { AABB } from '@/core/types';

// hitTestRect 的复用缓冲（静态方法不能用实例字段）
// wgpu-matrix 的 mat3 是 12 个元素（3×4，行尾留 1 个填充）
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
  // 预先在类里面声明一个成员
  private readonly projectionMatrixBuffer = new Float32Array(16);
  // 逆投影矩阵缓存
  private readonly invProjBuffer = new Float32Array(16);

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
    const mousePxX = pxX - rect.left;
    const mousePxY = pxY - rect.top;
    const pw = this.canvas.width;
    const ph = this.canvas.height;

    // 像素坐标 → WebGPU NDC: x[-1,1], y[-1,1], z [0,1]
    const ndcX = (2.0 * mousePxX) / pw - 1.0;
    const ndcY = 1.0 - (2.0 * mousePxY) / ph;

    // 相机投影矩阵
    const projMat = this.getCameraProjectionMatrix();
    const invProj = mat4.invert(projMat, this.invProjBuffer);
    if (!invProj) return { x: 0, y: 0 };

    // 齐次向量 NDC: (x,y,0,1)
    const ndcVec = vec4.create(ndcX, ndcY, 0, 1);
    // 乘逆投影矩阵
    const worldVec = vec4.transformMat4(ndcVec, invProj);
    // 齐次除法 w
    const worldX = worldVec[0] / worldVec[3];
    const worldY = worldVec[1] / worldVec[3];

    return { x: worldX, y: worldY };
  }

  public static hitTestRect(
    worldPt: { x: number; y: number },
    sx: number,
    sy: number,
    beta: number,
    tx: number,
    ty: number,
  ): boolean {
    // 世界点 → 图元局部空间（T·R·S 的逆矩阵），再判断是否落在单位方块 [-0.5, 0.5] 内。
    // 逆变换交给 wgpu-matrix，与 computeRotatedAABB、着色器共用同一套 2D 变换约定。
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

  /**
   * 生成2D模型矩阵：平移 * 旋转Z * 缩放
   * @param tx 中心X
   * @param ty 中心Y
   * @param beta 旋转弧度
   * @param sx X缩放
   * @param sy Y缩放
   */
  public static createModelMatrix(
    tx: number,
    ty: number,
    beta: number,
    sx: number,
    sy: number,
  ): Float32Array {
    const m = mat4.identity();
    mat4.translate(m, [tx, ty, 0], m);
    mat4.rotateZ(m, beta, m);
    mat4.scale(m, [sx, sy, 1], m);
    return m;
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
    const viewW = this.canvas.width / this.scale;
    const viewH = this.canvas.height / this.scale;
    const left = this.centerX - viewW / 2;
    const right = this.centerX + viewW / 2;
    const top = this.centerY - viewH / 2;
    const bottom = this.centerY + viewH / 2;

    mat4.ortho(left, right, bottom, top, -1, 1, this.projectionMatrixBuffer);

    return this.projectionMatrixBuffer;
  }
}
