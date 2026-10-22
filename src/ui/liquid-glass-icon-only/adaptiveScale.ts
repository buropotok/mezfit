/** The tab bar keeps its horizontal span while its complete 64px scene scales uniformly. */
export const LIQUID_TAB_BASE_HEIGHT = 64;

export function liquidTabScale(layoutWidth: number): number {
  if (!Number.isFinite(layoutWidth) || layoutWidth <= 0) return 1;
  const width = Math.max(320, Math.min(406, layoutWidth));
  const height = 44 + ((width - 320) / (406 - 320)) * (LIQUID_TAB_BASE_HEIGHT - 44);
  return height / LIQUID_TAB_BASE_HEIGHT;
}
