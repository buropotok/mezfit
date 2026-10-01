import { describe, expect, it } from 'vitest';
import uiKitHtml from '../ui-kit.html?raw';
import dayScheduleUiKitHtml from '../ui-kit-day-schedule.html?raw';
import mainSource from './main.tsx?raw';
import viteConfigSource from '../vite.config.ts?raw';

describe('UI kit HTML entry', () => {
  it('boots React without loading the Telegram SDK', () => {
    expect(uiKitHtml).toContain('src="/src/main.tsx"');
    expect(uiKitHtml).not.toContain('telegram-web-app.js');
  });

  it('serves fullscreen DaySchedule from its own SDK-free UI kit entry', () => {
    expect(dayScheduleUiKitHtml).toContain('src="/src/main.tsx"');
    expect(dayScheduleUiKitHtml).not.toContain('telegram-web-app.js');
    expect(viteConfigSource).toContain("'ui-kit-day-schedule.html'");
    expect(mainSource).toContain("window.location.pathname === '/ui-kit-day-schedule.html'");
    expect(mainSource).toContain('<DayScheduleCatalog fullScreen />');
  });
});
