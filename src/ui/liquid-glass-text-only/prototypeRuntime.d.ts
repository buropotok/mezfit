export type PrototypeController = { setValue(index: number): void; dispose(): void };
export function mountPrototype(root: ShadowRoot, initialIndex: number, onSelect: (index: number) => void, onAction?: () => void, actionWidthMultiplier?: 1 | 2): PrototypeController;
