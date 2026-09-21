import { describe, expect, it } from 'vitest';
import { resolveInviteToken } from './invite-start-param';

describe('resolveInviteToken', () => {
  it('uses the signed Telegram start parameter when present', () => {
    const signed = `invite_${'A'.repeat(36)}`;
    const fallback = `invite_${'b'.repeat(36)}`;

    expect(resolveInviteToken(signed, fallback)).toBe('a'.repeat(36));
  });

  it('falls back to the launch parameter when signed initData has no start parameter', () => {
    const fallback = `invite_${'c'.repeat(36)}`;

    expect(resolveInviteToken(undefined, fallback)).toBe('c'.repeat(36));
  });

  it('rejects malformed fallback values', () => {
    expect(resolveInviteToken(undefined, 'invite_not-a-token')).toBeNull();
  });
});
