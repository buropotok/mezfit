// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { startAppBootstrap } from './appBootstrap';

const spies = vi.hoisted(() => ({
  applyBackgroundSettings: vi.fn(),
  loadBrowserBackgroundSettings: vi.fn(() => ({ hue: 0, saturation: 0, value: 0 })),
  applyTypographySettings: vi.fn(),
  loadBrowserTypographySettings: vi.fn(() => ({})),
  applyTheme: vi.fn(),
  loadGlobalTheme: vi.fn(() => new Promise<never>(() => undefined)),
}));

vi.mock('./backgroundSettings', () => ({
  applyBackgroundSettings: spies.applyBackgroundSettings,
  loadBrowserBackgroundSettings: spies.loadBrowserBackgroundSettings,
}));
vi.mock('./typographySettings', () => ({
  applyTypographySettings: spies.applyTypographySettings,
  loadBrowserTypographySettings: spies.loadBrowserTypographySettings,
}));
vi.mock('./theme', () => ({
  applyTheme: spies.applyTheme,
  loadGlobalTheme: spies.loadGlobalTheme,
}));

describe('application bootstrap', () => {
  it('mounts the app while the optional theme request remains unresolved', async () => {
    const mount = vi.fn();

    await startAppBootstrap(mount);

    expect(spies.applyBackgroundSettings).toHaveBeenCalledOnce();
    expect(spies.applyTypographySettings).toHaveBeenCalledOnce();
    expect(spies.applyTheme).toHaveBeenCalledWith('default');
    expect(spies.loadGlobalTheme).toHaveBeenCalledOnce();
    expect(mount).toHaveBeenCalledOnce();
    expect(spies.applyTheme.mock.invocationCallOrder[0])
      .toBeLessThan(mount.mock.invocationCallOrder[0]);
    expect(spies.loadGlobalTheme.mock.invocationCallOrder[0])
      .toBeLessThan(mount.mock.invocationCallOrder[0]);
  });
});
