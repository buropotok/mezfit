import { describe, expect, it } from 'vitest';
import uiKitHtml from '../ui-kit.html?raw';

describe('UI kit HTML entry', () => {
  it('boots React without loading the Telegram SDK', () => {
    expect(uiKitHtml).toContain('src="/src/main.tsx"');
    expect(uiKitHtml).not.toContain('telegram-web-app.js');
  });
});
