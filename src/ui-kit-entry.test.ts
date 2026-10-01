import { describe, expect, it } from 'vitest';
import uiKitHtml from '../ui-kit.html?raw';
import mainSource from './main.tsx?raw';

describe('UI kit HTML entry', () => {
  it('boots React without loading the Telegram SDK', () => {
    expect(uiKitHtml).toContain('src="/src/main.tsx"');
    expect(uiKitHtml).not.toContain('telegram-web-app.js');
  });

  it('exposes a dedicated fullscreen DaySchedule UI kit route', () => {
    expect(mainSource).toContain("window.location.pathname === '/ui-kit/day-schedule'");
    expect(mainSource).toContain('<DayScheduleCatalog fullScreen />');
  });
});
