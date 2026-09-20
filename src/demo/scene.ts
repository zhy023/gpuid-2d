/**
 * 示例场景数据：设备图元 / 管线 / 阀门链与拓扑。
 *
 * 只负责「有哪些图元」，不碰 GPU 资源与绘制，方便以后换成真实图纸数据。
 */
import { DeviceStressTester } from '@/business/pid_schematic/device_stress_test';
import { PipeStressTester } from '@/business/pid_schematic/pipe_stress_test';
import { createValveDemoScene, type ValveDemoScene } from '@/business/pid_schematic/valve_demo';
import type { AABB } from '@/core/types';

/** 世界范围：压测图元与管线都布在这个矩形内 */
export const WORLD_BOUNDS: AABB = { minX: -20000, minY: -20000, maxX: 20000, maxY: 20000 };
/** 设备图元数量（压测规模） */
export const DEVICE_COUNT = 50000;
/** 随机管线数量（压测规模） */
export const PIPE_COUNT = 800;
/** 初始缩放：1 世界单位 = 0.1 屏幕像素 */
export const INITIAL_SCALE = 0.1;

export interface DemoScene {
  deviceTester: DeviceStressTester;
  pipeTester: PipeStressTester;
  valveScene: ValveDemoScene;
}

/**
 * 创建示例场景
 * @param device GPUDevice（管线压测需要提前建好管线资源）
 * @param canvasFormat 画布格式
 */
export async function createDemoScene(
  device: GPUDevice,
  canvasFormat: GPUTextureFormat,
): Promise<DemoScene> {
  const deviceTester = new DeviceStressTester(WORLD_BOUNDS, 0.002);
  deviceTester.generate(DEVICE_COUNT);

  const pipeTester = new PipeStressTester(WORLD_BOUNDS, 0.001);
  await pipeTester.generate(PIPE_COUNT, device, canvasFormat);

  return { deviceTester, pipeTester, valveScene: createValveDemoScene() };
}
