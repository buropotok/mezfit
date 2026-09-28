export type PrototypeController = { setValue(index: number): void; dispose(): void };
export type PrototypeEntranceVariant = 'icon-only' | 'center-spread';
export function mountPrototype(root: ShadowRoot, initialIndex: number, onSelect: (index: number) => void, playEntrance: boolean, fabHost?: HTMLDivElement | null, entranceVariant?: PrototypeEntranceVariant): PrototypeController;
