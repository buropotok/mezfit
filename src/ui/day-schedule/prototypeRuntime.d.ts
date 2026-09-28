export type PrototypeController = {
  setValue(index: number): void;
  playTap(index: number): void;
  resetValue(index: number): void;
  dispose(): void;
};
export function mountPrototype(root: ShadowRoot, initialIndex: number): PrototypeController;
