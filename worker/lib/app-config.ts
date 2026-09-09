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

export async function getGlobalTheme(db: D1Database): Promise<ThemeName> {
  const row = await db
    .prepare("SELECT value FROM app_setting WHERE key = 'theme' LIMIT 1")
    .first<{ value: string }>();
  return normalizeThemeName(row?.value);
}
