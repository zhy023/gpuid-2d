/**
 * 功能测试：设备图元批量渲染
 *
 * 验证点：5 万实例化矩形的视口剔除（四叉树）与实例缓冲上传，拖动相机时的帧预算。
 */
import { DeviceStressTester } from '@/business/pid_schematic/device_stress_test';
import type { DemoCase } from '@/demo/cases/types';
import { DEVICE_COUNT, INITIAL_SCALE, WORLD_BOUNDS } from '@/demo/scene';
import type { RectInstance } from '@/core/types';

export function createDeviceStressCase(): DemoCase {
  let tester: DeviceStressTester | null = null;
  let instances: RectInstance[] = [];

  return {
    name: 'device_stress',
    description: '设备图元：5 万实例化矩形 + 四叉树视口剔除',

    create(ctx) {
      tester = new DeviceStressTester(WORLD_BOUNDS, 0.002);
      tester.generate(DEVICE_COUNT);
      ctx.camera.scale = INITIAL_SCALE;
    },

    frame(ctx) {
      if (!tester) return;

      const result = tester.tick(ctx.camera.getViewportAABB(), ctx.camera.isDrag);
      // 可见集变化时才重建实例数组（选中态也会让 changed 为真）
      if (result?.changed) {
        instances = tester.buildRectInstanceList(result.visibleItems);
        console.log(`视口剔除：${result.visibleItems.length} / ${DEVICE_COUNT} 个图元`);
      }

      ctx.camera.getCameraProjectionMatrix();
      ctx.renderer.uploadProjectionMatrix(ctx.camera.getCameraProjectionMatrix());
      ctx.renderer.renderComposite({ rectInstances: instances });
    },

    dispose() {
      tester = null;
      instances = [];
    },
  };
}
