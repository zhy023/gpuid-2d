import type { AABB } from '@/core/types';

export interface SceneElement {
  readonly id: number;
  worldAABB: AABB;
  visible: boolean;
}
