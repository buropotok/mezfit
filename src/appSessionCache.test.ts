// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import type { MeResponse } from './api';
import { clearConfirmedAccount, matchesCurrentLaunch, readConfirmedAccount, saveConfirmedAccount } from './appSessionCache';

const initData = (id: number) => new URLSearchParams({
  user: JSON.stringify({ id, first_name: 'Тест' }),
  auth_date: '1794142800', hash: 'a'.repeat(64),
}).toString();
const me: MeResponse = { user: {
  id: 17, telegramUserId: '101', username: null, firstName: 'Тренер',
  lastName: null, languageCode: 'ru', photoUrl: null, isPremium: false,
}, roles: ['coach'] };

afterEach(() => window.localStorage.clear());

describe('confirmed local account warm start', () => {
  it('restores only the account matching the current Telegram identity', () => {
    saveConfirmedAccount(initData(101), me);
    expect(readConfirmedAccount(initData(101))).toEqual(me);
    expect(readConfirmedAccount(initData(202))).toBeNull();
  });
  it('does not treat arbitrary launch data as confirmation', () => {
    saveConfirmedAccount('telegram-init', me);
    expect(readConfirmedAccount('telegram-init')).toBeNull();
    saveConfirmedAccount(initData(101), me);
    expect(readConfirmedAccount(new URLSearchParams({ user: '{"id":101}' }).toString())).toBeNull();
  });
  it('rejects mismatches and supports revocation', () => {
    saveConfirmedAccount(initData(202), me);
    expect(readConfirmedAccount(initData(202))).toBeNull();
    saveConfirmedAccount(initData(101), me);
    clearConfirmedAccount(initData(101));
    expect(readConfirmedAccount(initData(101))).toBeNull();
  });
  it('detects mismatched live identities', () => {
    expect(matchesCurrentLaunch(initData(101), me)).toBe(true);
    expect(matchesCurrentLaunch(initData(202), me)).toBe(false);
  });
  it('rejects corrupt role data', () => {
    saveConfirmedAccount(initData(101), me);
    window.localStorage.setItem('mezfit.confirmedAccount.v1.101',
      JSON.stringify({ version: 1, me: { ...me, roles: ['admin'] } }));
    expect(readConfirmedAccount(initData(101))).toBeNull();
  });
});
