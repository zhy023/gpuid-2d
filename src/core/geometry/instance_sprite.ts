/**
 * 通用精灵实例构造：把「屏幕像素尺寸 + 图集 uv + 逐实例颜色」换算成实例化绘制所需的数据。
 *
 * 文字字形、贴图符号、设备图元都是同一个形状，统一走这里，
 * 避免各处重复写「像素 ÷ 相机缩放」这类换算。
 */
import type { RectInstance } from '@/core/types';

export interface SpriteInstanceOptions {
  /** 中心点（世界坐标） */
  tx: number;
  ty: number;
  /** 屏幕像素尺寸 */
  widthPx: number;
  heightPx: number;
  /** 相机缩放：1 世界单位对应多少屏幕像素 */
  pixelsPerWorldUnit: number;
  /** 图集 uv 矩形 (u0,v0,u1,v1)，默认整张纹理 */
  uv?: readonly [number, number, number, number];
  /** 逐实例颜色，默认全白（贴图原色） */
  color?: readonly [number, number, number, number];
  beta?: number;
  selected?: number;
}

export function spriteInstance(options: SpriteInstanceOptions): RectInstance {
  const {
    tx,
    ty,
    widthPx,
    heightPx,
    pixelsPerWorldUnit,
    uv = [0, 0, 1, 1] as const,
    color = [1, 1, 1, 1] as const,
    beta = 0,
    selected = 0,
  } = options;

  const worldPerPixel = 1 / Math.max(pixelsPerWorldUnit, 1e-6);

  return {
    tx,
    ty,
    sx: widthPx * worldPerPixel,
    sy: heightPx * worldPerPixel,
    beta,
    selected,
    u0: uv[0],
    v0: uv[1],
    u1: uv[2],
    v1: uv[3],
    colorR: color[0],
    colorG: color[1],
    colorB: color[2],
    colorA: color[3],
  };
}
