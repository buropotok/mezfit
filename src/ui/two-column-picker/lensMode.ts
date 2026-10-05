export type TwoColumnPickerLensMode = 'auto' | 'displacement' | 'ios';
export type ResolvedTwoColumnPickerLensMode = Exclude<TwoColumnPickerLensMode, 'auto'>;

export interface PickerNavigatorInfo {
  userAgent: string;
  maxTouchPoints?: number;
}

function getNavigatorInfo(): PickerNavigatorInfo | null {
  if (typeof navigator === 'undefined') return null;
  return navigator;
}

export function isIosPickerDevice(
  navigatorInfo: PickerNavigatorInfo | null = getNavigatorInfo(),
): boolean {
  if (!navigatorInfo) return false;

  const { userAgent, maxTouchPoints = 0 } = navigatorInfo;
  if (/iPhone|iPad|iPod/i.test(userAgent)) return true;

  // iPadOS may identify itself as macOS while still using touch/WebKit.
  return /Macintosh/i.test(userAgent) && maxTouchPoints > 1;
}

export function resolveTwoColumnPickerLensMode(
  mode: TwoColumnPickerLensMode,
  navigatorInfo: PickerNavigatorInfo | null = getNavigatorInfo(),
): ResolvedTwoColumnPickerLensMode {
  if (mode !== 'auto') return mode;
  return isIosPickerDevice(navigatorInfo) ? 'ios' : 'displacement';
}
