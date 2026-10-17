import { hsvToHex, type HsvColor } from './ui/colorMath';

export type BackgroundSettings = HsvColor;

export const DEFAULT_BACKGROUND_SETTINGS: Readonly<BackgroundSettings> = Object.freeze({
  hue: 0,
  saturation: 0,
  value: 0,
});

const BACKGROUND_SETTINGS_STORAGE_KEY = 'mezfit.backgroundSettings.v1';

export function normalizeBackgroundSettings(value: unknown): BackgroundSettings {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { ...DEFAULT_BACKGROUND_SETTINGS };
  }

  const hue = Reflect.get(value, 'hue');
  const saturation = Reflect.get(value, 'saturation');
  const brightness = Reflect.get(value, 'value');
  if (typeof hue !== 'number' || !Number.isFinite(hue) || hue < 0 || hue > 360
    || typeof saturation !== 'number' || !Number.isFinite(saturation) || saturation < 0 || saturation > 100
    || typeof brightness !== 'number' || !Number.isFinite(brightness) || brightness < 0 || brightness > 100) {
    return { ...DEFAULT_BACKGROUND_SETTINGS };
  }
  return { hue, saturation, value: brightness };
}

export function loadBackgroundSettings(storage: Pick<Storage, 'getItem'>): BackgroundSettings {
  try {
    const raw = storage.getItem(BACKGROUND_SETTINGS_STORAGE_KEY);
    return raw ? normalizeBackgroundSettings(JSON.parse(raw) as unknown) : { ...DEFAULT_BACKGROUND_SETTINGS };
  } catch {
    return { ...DEFAULT_BACKGROUND_SETTINGS };
  }
}

export function saveBackgroundSettings(storage: Pick<Storage, 'setItem'>, settings: BackgroundSettings): void {
  try {
    storage.setItem(BACKGROUND_SETTINGS_STORAGE_KEY, JSON.stringify(normalizeBackgroundSettings(settings)));
  } catch {
    // Visual preferences remain usable for this session when storage is unavailable.
  }
}

export function loadBrowserBackgroundSettings(): BackgroundSettings {
  try {
    return loadBackgroundSettings(window.localStorage);
  } catch {
    return { ...DEFAULT_BACKGROUND_SETTINGS };
  }
}

export function saveBrowserBackgroundSettings(settings: BackgroundSettings): void {
  try {
    saveBackgroundSettings(window.localStorage, settings);
  } catch {
    // Accessing local storage can be denied in Telegram WebView.
  }
}

export function applyBackgroundSettings(
  settings: BackgroundSettings,
  target: Pick<CSSStyleDeclaration, 'setProperty'> = document.documentElement.style,
): void {
  target.setProperty('--app-background-color', hsvToHex(normalizeBackgroundSettings(settings)));
}
