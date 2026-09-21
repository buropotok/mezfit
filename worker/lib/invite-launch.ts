export const INVITE_START_PARAM_HEADER = 'x-mezfit-invite-start-param';

export function resolveInviteStartParam(
  request: Request,
  signedStartParam?: string,
): string | undefined {
  // This value is launch context only, never identity. Authentication still
  // comes exclusively from the signed Telegram initData.
  const explicitStartParam = request.headers.get(INVITE_START_PARAM_HEADER)?.trim();
  return explicitStartParam || signedStartParam;
}
