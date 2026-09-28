export type PrototypeController = { setValue(index: number): void; dispose(): void };
export function mountPrototype(root: ShadowRoot, initialIndex: number, onSelect: (index: number) => void, playEntrance: boolean): PrototypeController;
