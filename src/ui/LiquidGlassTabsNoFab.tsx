import { LiquidGlassIconOnly, type LiquidGlassIconOnlyProps, type LiquidGlassIconOnlyTab } from './LiquidGlassIconOnly';

export type LiquidGlassTabsNoFabTab = LiquidGlassIconOnlyTab;
export type LiquidGlassTabsNoFabProps = Omit<LiquidGlassIconOnlyProps, 'fab'>;

/**
 * Compatibility wrapper for the former standalone no-FAB tab bar.
 * The canonical owner is LiquidGlassIconOnly, which always uses the approved
 * no-FAB entrance.
 */
export function LiquidGlassTabsNoFab(props: LiquidGlassTabsNoFabProps) {
  return <LiquidGlassIconOnly {...props} />;
}
