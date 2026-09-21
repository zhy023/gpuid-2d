/**
 * 示例场景数据：设备图元 / 管线 / 阀门链与拓扑。
 *
 * 只负责「有哪些图元」，不碰 GPU 资源与绘制，方便以后换成真实图纸数据。
 */
import { DeviceStressTester } from '@/business/pid_schematic/device_stress_test';
import { PipeStressTester } from '@/business/pid_schematic/pipe_stress_test';
import { createValveDemoScene, type ValveDemoScene } from '@/business/pid_schematic/valve_demo';
import { parseMxDocument } from '@/business/pid_schematic/drawio/mx_document';
import {
  toPidScene,
  type DrawioValveIcon,
  type PidLabel,
} from '@/business/pid_schematic/drawio/to_pid_scene';
import type { PidScene } from '@/business/pid_schematic/pid_scene';
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

/** 真实图纸的路径（draw.io 的 mxGraphModel；SVG 只是导出快照，不作为数据源） */
export const DRAWIO_URL = '/assets/graph/meta_demo.xml';

export interface DrawioDemoScene {
  /** 图纸图元（设备 / 管线 / 阀门）的空间索引 */
  pidScene: PidScene;
  /** 位号：文字 + 位置 + 颜色 + 字号 */
  labels: PidLabel[];
  /** 图元 id → 内联图标 data URL（绘制端按它贴图） */
  icons: Map<number, string>;
  /** 图纸世界范围（相机取景用） */
  bounds: AABB;
  stats: {
    devices: number;
    valves: number;
    pipes: number;
    labels: number;
    icons: number;
    skipped: number;
  };
}

import { VALVE_OFF_URL, VALVE_ON_URL } from '@/demo/resources';
/** 把本地阀门贴图读成 data URL，供图纸翻译层识别阀门单元 */
async function loadValveIcons(): Promise<DrawioValveIcon[]> {
  const toDataUrl = async (url: string): Promise<string> => {
    const blob = await (await fetch(url)).blob();
    const base64 = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(new Error(`读取失败：${url}`));
      reader.readAsDataURL(blob);
    });
    return base64;
  };

  return [{ url: await toDataUrl(VALVE_OFF_URL) }, { url: await toDataUrl(VALVE_ON_URL) }];
}

/**
 * 加载真实图纸：XML → 规范化节点 → PidScene
 * 浏览器内置 DOMParser（解析器本身零依赖，测试里注入 @xmldom/xmldom）
 */
export async function createDrawioScene(): Promise<DrawioDemoScene> {
  const xml = await (await fetch(DRAWIO_URL)).text();
  const document = parseMxDocument(xml, new DOMParser());
  // 阀门单元（内联的是阀门贴图）翻成 ValveGraphic：可选中 + 自带开/关状态
  const { scene, labels, icons, bounds, stats } = toPidScene(document, {
    valveIcons: await loadValveIcons(),
  });
  // 阀门与管线都保持默认关闭：图纸一进来是静止的初始态，
  // 流动（flow 能力）由后续交互再打开
  console.log(
    `[drawio] 设备 ${stats.devices} / 阀门 ${stats.valves} / 管线 ${stats.pipes}` +
      ` / 位号 ${stats.labels}` +
      ` / 范围 ${Math.round(bounds.maxX - bounds.minX)}×${Math.round(bounds.maxY - bounds.minY)}`,
  );
  return { pidScene: scene, labels, icons, bounds, stats };
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
