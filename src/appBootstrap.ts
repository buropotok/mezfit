import { applyBackgroundSettings, loadBrowserBackgroundSettings } from './backgroundSettings';
import { applyTheme, loadGlobalTheme } from './theme';
import { applyTypographySettings, loadBrowserTypographySettings } from './typographySettings';

/**
 * Prepare visual settings before mounting the application, but do not allow the
 * optional remote theme configuration to block the first React render.
 */
export async function startAppBootstrap(mount: () => void | Promise<void>): Promise<void> {
  applyBackgroundSettings(loadBrowserBackgroundSettings());
  applyTypographySettings(loadBrowserTypographySettings());
  applyTheme('default');
  void loadGlobalTheme();

  await mount();
}
