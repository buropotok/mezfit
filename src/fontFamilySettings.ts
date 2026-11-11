/**
 * App-wide font selection is a local presentation preference, not synchronized
 * business data. Keep the public CSS token stable for app text and Konsta.
 */
export const FONT_FAMILIES = ['inter', 'zen-maru-gothic'] as const;
export type FontFamily = (typeof FONT_FAMILIES)[number];

export const DEFAULT_FONT_FAMILY: FontFamily = 'inter';
// v1 automatically saved the old Zen default on every mount, so it cannot
// distinguish an explicit user selection from an untouched default.
// Start a fresh preference version so existing installations receive Inter;
// subsequent manual choices (including Zen) persist normally.
const FONT_FAMILY_STORAGE_KEY = 'mezfit.fontFamily.v2';

export function normalizeFontFamily(value: unknown): FontFamily {
  return value === 'zen-maru-gothic' ? 'zen-maru-gothic' : DEFAULT_FONT_FAMILY;
}

export function loadFontFamily(storage: Pick<Storage, 'getItem'>): FontFamily {
  try {
    return normalizeFontFamily(storage.getItem(FONT_FAMILY_STORAGE_KEY));
  } catch {
    return DEFAULT_FONT_FAMILY;
  }
}

export function saveFontFamily(storage: Pick<Storage, 'setItem'>, value: FontFamily): void {
  try {
    storage.setItem(FONT_FAMILY_STORAGE_KEY, normalizeFontFamily(value));
  } catch {
    // Keep the selected font in the current session if storage is blocked.
  }
}

type FontStyleTarget = Pick<CSSStyleDeclaration, 'setProperty'>;

export function applyFontFamily(
  value: FontFamily,
  target: FontStyleTarget = document.documentElement.style,
): void {
  const family = normalizeFontFamily(value) === 'inter'
    ? "'Inter', 'Zen Maru Gothic', sans-serif"
    : "'Zen Maru Gothic', sans-serif";
  target.setProperty('--ui-font-family', family);
}

type FontStorageProvider = () => Pick<Storage, 'getItem' | 'setItem'>;
const browserStorageProvider: FontStorageProvider = () => window.localStorage;

export function loadBrowserFontFamily(
  getStorage: FontStorageProvider = browserStorageProvider,
): FontFamily {
  try {
    return loadFontFamily(getStorage());
  } catch {
    return DEFAULT_FONT_FAMILY;
  }
}

export function saveBrowserFontFamily(
  value: FontFamily,
  getStorage: FontStorageProvider = browserStorageProvider,
): void {
  try {
    saveFontFamily(getStorage(), value);
  } catch {
    // Access to the browser storage object can itself throw in a WebView.
  }
}
