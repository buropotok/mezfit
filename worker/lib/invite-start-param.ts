const INVITE_PREFIX = 'invite_';
const INVITE_TOKEN_PATTERN = /^[a-f0-9]{36}$/i;

export function inviteTokenFromStartParam(startParam?: string): string | null {
  if (!startParam?.startsWith(INVITE_PREFIX)) return null;
  const token = startParam.slice(INVITE_PREFIX.length);
  return INVITE_TOKEN_PATTERN.test(token) ? token.toLowerCase() : null;
}

export function resolveInviteToken(
  signedStartParam: string | undefined,
  fallbackStartParam: string | null,
): string | null {
  return inviteTokenFromStartParam(signedStartParam ?? fallbackStartParam ?? undefined);
}
