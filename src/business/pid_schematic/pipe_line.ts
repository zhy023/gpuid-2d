import type { AABB } from '@/core/types';
import { expandPolyline, calcPolylineBounds } from '@/core/geometry/polyline';
import type { PipePolylineItem } from '@/business/pid_schematic/types';
import {
  snapPipeLineWidthPx,
  PIPE_LINE_WIDTH_DEFAULT_PX,
} from '@/business/pid_schematic/pipe_style';

/**
 * 更新管线几何缓存
 * points / lineWidthPx 修改后设置dirty=true，调用这个函数生成顶点
 * @param pixelsPerWorldUnit 当前相机缩放；仅影响 CPU 侧缓存几何的世界宽度
 */
export function rebuildPipeGeometry(pipe: PipePolylineItem, pixelsPerWorldUnit = 1): void {
  const worldWidth = pipe.lineWidthPx / Math.max(pixelsPerWorldUnit, 1e-6);
  const res = expandPolyline(pipe.points, worldWidth);
  pipe.geoCache = res;
}

/**
 * 计算管线AABB，用于四叉树插入/更新
 */
export function computePipeAABB(pipe: PipePolylineItem): AABB {
  return calcPolylineBounds(pipe.points);
}

/**
 * 切换管线流动样式：阀门打开 → 下游管线流动；阀门关闭 → 恢复默认样式。
 * 实例数据每帧重新打包，所以改完下一帧就生效，不需要标 dirty（那是几何变更用的）
 * @param flowing 是否流动
 * @param speed 流动速度倍率，仅 flowing = true 时生效
 */
export function setPipeFlow(pipe: PipePolylineItem, flowing: boolean, speed = 1.0): void {
  pipe.flowSpeed = flowing ? Math.max(speed, 1e-3) : 0;
}

/**
 * 管线图元自身的实例变换保持单位：多段线顶点已在世界坐标系内，
 * 真正提交绘制时由 pipe_render_pass 按「每段一个实例」现算中点/角度/段长
 */
const PIPE_IDENTITY_TRANSFORM = { tx: 0, ty: 0, sx: 1, sy: 1, beta: 0 } as const;

/**
 * 创建管线示例对象
 */
export function createPipeItem(
  id: number,
  points: Array<{ x: number; y: number }>,
  lineWidthPx = PIPE_LINE_WIDTH_DEFAULT_PX,
): PipePolylineItem {
  return {
    id,
    type: 'pipeline',
    ...PIPE_IDENTITY_TRANSFORM,
    selected: 0,
    dirty: true,
    points,
    lineWidthPx: snapPipeLineWidthPx(lineWidthPx),
    geoCache: null,
    flowSpeed: 1.0,
    worldAABB: calcPolylineBounds(points),
  };
}
