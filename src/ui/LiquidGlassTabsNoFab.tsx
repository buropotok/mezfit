import { LiquidGlassIconOnly, type LiquidGlassIconOnlyProps, type LiquidGlassIconOnlyTab } from './LiquidGlassIconOnly';

export type LiquidGlassTabsNoFabTab = LiquidGlassIconOnlyTab;
export type LiquidGlassTabsNoFabProps = Omit<LiquidGlassIconOnlyProps, 'fab'>;

/**
 * Compatibility wrapper for the former standalone no-FAB tab bar.
 * The canonical owner is LiquidGlassIconOnly, which now selects the approved
 * no-FAB entrance automatically whenever no FAB is supplied.
 */
export function LiquidGlassTabsNoFab(props: LiquidGlassTabsNoFabProps) {
  return <LiquidGlassIconOnly {...props} />;
}
