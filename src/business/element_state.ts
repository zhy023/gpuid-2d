export type ElementState = 'normal' | 'selected' | 'disabled';

export class ElementStateStore {
  private readonly states = new Map<number, ElementState>();

  set(elementId: number, state: ElementState): void {
    this.states.set(elementId, state);
  }

  get(elementId: number): ElementState {
    return this.states.get(elementId) ?? 'normal';
  }

  clear(): void {
    this.states.clear();
  }
}
