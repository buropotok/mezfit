export const TYPOGRAPHY_ROLES = [
  'large-title',
  'title',
  'headline',
  'body',
  'footnote',
  'caption',
] as const;

export type TypographyRole = (typeof TYPOGRAPHY_ROLES)[number];

export const TYPOGRAPHY_WEIGHTS = [300, 400, 500, 600, 700, 900] as const;
export type TypographyWeight = (typeof TYPOGRAPHY_WEIGHTS)[number];

export const TYPOGRAPHY_FONT_STYLES = ['normal', 'italic'] as const;
export type TypographyFontStyle = (typeof TYPOGRAPHY_FONT_STYLES)[number];

export type TypographyPresetSettings = {
  size: number;
  weight: TypographyWeight;
  fontStyle: TypographyFontStyle;
  lineHeight: number;
  letterSpacing: number;
};

export type TypographySettings = Record<TypographyRole, TypographyPresetSettings>;

export const TYPOGRAPHY_ROLE_LABELS: Readonly<Record<TypographyRole, string>> = Object.freeze({
  'large-title': 'Large title',
  title: 'Title',
  headline: 'Headline',
  body: 'Body',
  footnote: 'Footnote',
  caption: 'Caption',
});

const DEFAULTS: Readonly<Record<TypographyRole, Readonly<TypographyPresetSettings>>> = {
  'large-title': { size: 24, weight: 500, fontStyle: 'normal', lineHeight: 24, letterSpacing: 0 },
  title: { size: 20, weight: 500, fontStyle: 'normal', lineHeight: 24, letterSpacing: 0.35 },
  headline: { size: 17, weight: 400, fontStyle: 'normal', lineHeight: 22, letterSpacing: 0.5 },
  body: { size: 15, weight: 300, fontStyle: 'normal', lineHeight: 20, letterSpacing: 0.35 },
  footnote: { size: 13, weight: 300, fontStyle: 'normal', lineHeight: 18, letterSpacing: 0.55 },
  caption: { size: 12, weight: 300, fontStyle: 'normal', lineHeight: 16, letterSpacing: 0.4 },
};

const TYPOGRAPHY_SETTINGS_STORAGE_KEY = 'mezfit.typographySettings.v1';

function clonePreset(value: Readonly<TypographyPresetSettings>): TypographyPresetSettings {
  return { ...value };
}

export function defaultTypographySettings(): TypographySettings {
  return Object.fromEntries(
    TYPOGRAPHY_ROLES.map((role) => [role, clonePreset(DEFAULTS[role])]),
  ) as TypographySettings;
}

function isTypographyWeight(value: unknown): value is TypographyWeight {
  return typeof value === 'number' && TYPOGRAPHY_WEIGHTS.includes(value as TypographyWeight);
}

function isTypographyFontStyle(value: unknown): value is TypographyFontStyle {
  return typeof value === 'string' && TYPOGRAPHY_FONT_STYLES.includes(value as TypographyFontStyle);
}

function boundedNumber(value: unknown, fallback: number, min: number, max: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max
    ? value
    : fallback;
}

function normalizePreset(value: unknown, fallback: Readonly<TypographyPresetSettings>): TypographyPresetSettings {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return clonePreset(fallback);

  const size = Reflect.get(value, 'size');
  const weight = Reflect.get(value, 'weight');
  const fontStyle = Reflect.get(value, 'fontStyle');
  const lineHeight = Reflect.get(value, 'lineHeight');
  const letterSpacing = Reflect.get(value, 'letterSpacing');

  return {
    size: boundedNumber(size, fallback.size, 8, 64),
    weight: isTypographyWeight(weight) ? weight : fallback.weight,
    fontStyle: isTypographyFontStyle(fontStyle) ? fontStyle : fallback.fontStyle,
    lineHeight: boundedNumber(lineHeight, fallback.lineHeight, 8, 80),
    letterSpacing: boundedNumber(letterSpacing, fallback.letterSpacing, -2, 4),
  };
}

export function normalizeTypographySettings(value: unknown): TypographySettings {
  const defaults = defaultTypographySettings();
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return defaults;

  return Object.fromEntries(
    TYPOGRAPHY_ROLES.map((role) => [
      role,
      normalizePreset(Reflect.get(value, role), defaults[role]),
    ]),
  ) as TypographySettings;
}

export function loadTypographySettings(storage: Pick<Storage, 'getItem'>): TypographySettings {
  try {
    const raw = storage.getItem(TYPOGRAPHY_SETTINGS_STORAGE_KEY);
    return raw ? normalizeTypographySettings(JSON.parse(raw) as unknown) : defaultTypographySettings();
  } catch {
    return defaultTypographySettings();
  }
}

export function saveTypographySettings(
  storage: Pick<Storage, 'setItem'>,
  settings: TypographySettings,
): void {
  try {
    storage.setItem(TYPOGRAPHY_SETTINGS_STORAGE_KEY, JSON.stringify(normalizeTypographySettings(settings)));
  } catch {
    // Typography remains usable for the current session when storage is unavailable.
  }
}

type TypographyStyleTarget = Pick<CSSStyleDeclaration, 'setProperty'>;

export function applyTypographySettings(
  settings: TypographySettings,
  target: TypographyStyleTarget = document.documentElement.style,
): void {
  const normalized = normalizeTypographySettings(settings);
  for (const role of TYPOGRAPHY_ROLES) {
    const value = normalized[role];
    target.setProperty(`--ui-font-size-${role}`, `${value.size}px`);
    target.setProperty(`--ui-line-height-${role}`, `${value.lineHeight}px`);
    target.setProperty(`--ui-letter-spacing-${role}`, `${value.letterSpacing}px`);
    target.setProperty(`--ui-font-weight-${role}`, String(value.weight));
    target.setProperty(`--ui-font-style-${role}`, value.fontStyle);
  }
}

type TypographyStorageProvider = () => Pick<Storage, 'getItem' | 'setItem'>;

const browserStorageProvider: TypographyStorageProvider = () => window.localStorage;

export function loadBrowserTypographySettings(
  getStorage: TypographyStorageProvider = browserStorageProvider,
): TypographySettings {
  try {
    return loadTypographySettings(getStorage());
  } catch {
    return defaultTypographySettings();
  }
}

export function saveBrowserTypographySettings(
  settings: TypographySettings,
  getStorage: TypographyStorageProvider = browserStorageProvider,
): void {
  try {
    saveTypographySettings(getStorage(), settings);
  } catch {
    // Accessing the storage object itself can be denied by the WebView/browser.
  }
}
