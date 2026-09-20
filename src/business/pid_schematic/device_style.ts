/**
 * 设备图元（阀门等符号）绘制规格。
 * 与管线一致：尺寸以屏幕像素为准，缩放不改变观感，只是符号本身按世界坐标摆放。
 */
/** 设备符号最小边长的屏幕像素：最小是一个 4×4 的正方形 */
export const DEVICE_SYMBOL_MIN_PX = 4;

/**
 * 符号世界尺寸下限：4px 折算到世界单位。
 * 缩得很小时符号会小于 4px，此时用这个下限把它撑到 4×4 像素，避免糊成一点。
 */
export function minDeviceSymbolWorldSize(pixelsPerWorldUnit: number): number {
  return DEVICE_SYMBOL_MIN_PX / Math.max(pixelsPerWorldUnit, 1e-6);
}
