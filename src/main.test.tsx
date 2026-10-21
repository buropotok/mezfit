// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

const spies = vi.hoisted(() => ({
  render: vi.fn(),
  applyTheme: vi.fn(),
  loadGlobalTheme: vi.fn(() => new Promise<never>(() => undefined)),
}));

vi.mock('react-dom/client', () => ({
  createRoot: () => ({ render: spies.render }),
}));
vi.mock('./App', () => ({ App: () => null }));
vi.mock('./theme', () => ({
  applyTheme: spies.applyTheme,
  loadGlobalTheme: spies.loadGlobalTheme,
}));
vi.mock('./backgroundSettings', () => ({
  applyBackgroundSettings: vi.fn(),
  loadBrowserBackgroundSettings: () => ({}),
}));
vi.mock('./typographySettings', () => ({
  applyTypographySettings: vi.fn(),
  loadBrowserTypographySettings: () => ({}),
}));
vi.mock('./telegram', () => ({
  getTelegramWebApp: () => null,
  getTelegramLaunchStartParam: () => null,
}));
vi.mock('./bootDiagnostics', () => ({ finishBoot: vi.fn() }));

beforeEach(() => {
  document.body.innerHTML = '<div id="root"></div>';
});

describe('Mezfit bootstrap', () => {
  it('renders the application without waiting for the theme config request', async () => {
    await import('./main');

    expect(spies.applyTheme).toHaveBeenCalledWith('default');
    expect(spies.loadGlobalTheme).toHaveBeenCalledTimes(1);
    expect(spies.render).toHaveBeenCalledTimes(1);
  });
});
