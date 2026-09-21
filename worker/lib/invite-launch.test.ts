import { describe, expect, it } from 'vitest';
import { INVITE_START_PARAM_HEADER, resolveInviteStartParam } from './invite-launch';

describe('resolveInviteStartParam', () => {
  it('prefers the explicit current launch parameter over stale signed launch context', () => {
    const request = new Request('https://mezfit.example/api/invite/current', {
      headers: {
        [INVITE_START_PARAM_HEADER]: `invite_${'b'.repeat(36)}`,
      },
    });

    expect(resolveInviteStartParam(request, `invite_${'a'.repeat(36)}`))
      .toBe(`invite_${'b'.repeat(36)}`);
  });

  it('falls back to the signed Telegram start parameter', () => {
    const request = new Request('https://mezfit.example/api/invite/current');

    expect(resolveInviteStartParam(request, `invite_${'a'.repeat(36)}`))
      .toBe(`invite_${'a'.repeat(36)}`);
  });

  it('ignores an empty explicit launch parameter', () => {
    const request = new Request('https://mezfit.example/api/invite/current', {
      headers: {
        [INVITE_START_PARAM_HEADER]: '   ',
      },
    });

    expect(resolveInviteStartParam(request, `invite_${'a'.repeat(36)}`))
      .toBe(`invite_${'a'.repeat(36)}`);
  });
});
