import { GLASS_PRESETS, type GlassPresetName } from './ui/glassMaterial';
import { MEZFIT_NAVBAR_GLASS_PRESET } from './ui/mezfitNavbarConfig';

export type GlassSettings = {
  preset: GlassPresetName;
  optics: boolean;
};

export function isGlassPresetName(value: unknown): value is GlassPresetName {
  return typeof value === 'string'
    && Object.prototype.hasOwnProperty.call(GLASS_PRESETS, value);
}

export const GLASS_PRESET_NAMES: readonly GlassPresetName[] = Object.freeze(
  Object.keys(GLASS_PRESETS).filter(isGlassPresetName),
);

export const DEFAULT_GLASS_SETTINGS: Readonly<GlassSettings> = Object.freeze({
  preset: MEZFIT_NAVBAR_GLASS_PRESET,
  optics: false,
});

const GLASS_SETTINGS_STORAGE_KEY = 'mezfit.glassSettings';

export function loadGlassSettings(storage: Pick<Storage, 'getItem'>): GlassSettings {
  try {
    const raw = storage.getItem(GLASS_SETTINGS_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_GLASS_SETTINGS };

    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return { ...DEFAULT_GLASS_SETTINGS };
    }

    const preset = Reflect.get(parsed, 'preset');
    const optics = Reflect.get(parsed, 'optics');

    return {
      preset: isGlassPresetName(preset) ? preset : DEFAULT_GLASS_SETTINGS.preset,
      optics: typeof optics === 'boolean' ? optics : DEFAULT_GLASS_SETTINGS.optics,
    };
  } catch {
    return { ...DEFAULT_GLASS_SETTINGS };
  }
}

export function saveGlassSettings(storage: Pick<Storage, 'setItem'>, settings: GlassSettings): void {
  try {
    storage.setItem(GLASS_SETTINGS_STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Visual preferences remain usable for the current session when storage is unavailable.
  }
}

type GlassStorageProvider = () => Pick<Storage, 'getItem' | 'setItem'>;

const browserStorageProvider: GlassStorageProvider = () => window.localStorage;

export function loadBrowserGlassSettings(
  getStorage: GlassStorageProvider = browserStorageProvider,
): GlassSettings {
  try {
    return loadGlassSettings(getStorage());
  } catch {
    return { ...DEFAULT_GLASS_SETTINGS };
  }
}

export function saveBrowserGlassSettings(
  settings: GlassSettings,
  getStorage: GlassStorageProvider = browserStorageProvider,
): void {
  try {
    saveGlassSettings(getStorage(), settings);
  } catch {
    // Accessing the storage object itself can be denied by the WebView/browser.
  }
}
