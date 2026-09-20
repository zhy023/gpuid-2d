import type { SceneElement } from '@/scene/element';

export class Scene {
  private readonly elements = new Map<number, SceneElement>();

  add(element: SceneElement): void {
    this.elements.set(element.id, element);
  }

  remove(id: number): void {
    this.elements.delete(id);
  }

  get(id: number): SceneElement | undefined {
    return this.elements.get(id);
  }

  values(): IterableIterator<SceneElement> {
    return this.elements.values();
  }

  clear(): void {
    this.elements.clear();
  }
}
