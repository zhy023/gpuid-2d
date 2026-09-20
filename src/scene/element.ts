import type { AABB } from '@/engine/types';

export interface SceneElement {
  readonly id: number;
  worldAABB: AABB;
  visible: boolean;
}
