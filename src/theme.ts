export const THEME_NAMES = [
  'default',
  'graphite-cobalt',
  'emerald-sand',
  'burgundy-milk',
  'black-terracotta',
] as const;

export type ThemeName = (typeof THEME_NAMES)[number];

const themeNames = new Set<string>(THEME_NAMES);

export function normalizeThemeName(value: unknown): ThemeName {
  return typeof value === 'string' && themeNames.has(value) ? (value as ThemeName) : 'default';
}

export function applyTheme(theme: ThemeName): void {
  document.documentElement.dataset.theme = theme;
}

export async function loadGlobalTheme(): Promise<ThemeName> {
  let theme: ThemeName = 'default';
  try {
    const response = await fetch('/api/config', { cache: 'no-store' });
    if (response.ok) {
      const payload = (await response.json()) as { theme?: unknown };
      theme = normalizeThemeName(payload.theme);
    }
  } catch {
    // The default theme is intentionally usable without the config endpoint.
  }
  applyTheme(theme);
  return theme;
}
