import { describe, expect, it } from 'vitest';
import { parseBrowserSession } from './browserSession';

describe('BrowserTelegramLogin session contract', () => {
  it('accepts only a server-confirmed same-origin browser identity', () => {
    expect(parseBrowserSession({
      authenticated: true, telegramUserId: '208192415',
      name: 'MezFit Tester', username: 'tester',
    })).toEqual({
      telegramUserId: '208192415', name: 'MezFit Tester', username: 'tester',
    });
  });

  it('rejects missing authentication, malformed IDs, and wrong field types', () => {
    for (const input of [
      null,
      { authenticated: false, telegramUserId: '123', name: '', username: '' },
      { authenticated: true, telegramUserId: 123, name: '', username: '' },
      { authenticated: true, telegramUserId: '0', name: '', username: '' },
      { authenticated: true, telegramUserId: '123', name: { html: '<img />' }, username: '' },
      { authenticated: true, telegramUserId: '123', name: '', username: null },
      { authenticated: true, telegramUserId: '123', name: 'x'.repeat(121), username: '' },
    ]) {
      expect(parseBrowserSession(input)).toBeNull();
    }
  });

  it('does not accept Mini App credentials as browser login proof', () => {
    expect(parseBrowserSession({
      authenticated: true, initData: 'user=1&hash=fake', telegramUserId: '123',
    })).toBeNull();
  });
});
