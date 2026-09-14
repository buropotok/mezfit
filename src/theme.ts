import { BootTimeoutError, errorName, markBoot, reportBoot, withBootTimeout } from './bootDiagnostics';

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
  markBoot('theme-request-start');
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  try {
    const { response, payload } = await withBootTimeout(
      (async () => {
        const response = await fetch('/api/config', {
          cache: 'no-store',
          ...(controller ? { signal: controller.signal } : {}),
        });
        const payload = response.ok ? (await response.json()) as { theme?: unknown } : null;
        return { response, payload };
      })(),
      5000,
      'theme-request-timeout',
      () => controller?.abort(),
    );
    if (response.ok && payload) {
      theme = normalizeThemeName(payload.theme);
      markBoot('theme-request-success', { httpStatus: response.status });
    } else {
      reportBoot('theme-request-http-error', { httpStatus: response.status });
    }
  } catch (error) {
    if (!(error instanceof BootTimeoutError)) {
      reportBoot('theme-request-error', { errorName: errorName(error) });
    }
    // The default theme is intentionally usable without the config endpoint.
  }
  applyTheme(theme);
  markBoot('theme-applied', { reason: theme });
  return theme;
}
