import { describe, expect, it } from 'vitest';
import html from '../index.html?raw';

describe('Telegram launch bootstrap', () => {
  it('captures the Mini App launch parameter before Telegram SDK execution', () => {
    const captureIndex = html.indexOf('var launchStartParam = captureLaunchStartParam();');
    const sdkIndex = html.indexOf('src="https://telegram.org/js/telegram-web-app.js"');

    expect(captureIndex).toBeGreaterThanOrEqual(0);
    expect(sdkIndex).toBeGreaterThan(captureIndex);
    expect(html).toContain("params.get('tgWebAppStartParam')");
    expect(html).toContain('launchParamFrom(window.location.search)');
    expect(html).toContain('launchParamFrom(window.location.hash)');
  });
});
