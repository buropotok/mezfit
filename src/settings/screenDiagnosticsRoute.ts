/** The Main Mini App deep link opens Settings → Screen diagnostics. */
export const SCREEN_DIAGNOSTICS_START_PARAM = 'screen_diagnostics';
export const SCREEN_DIAGNOSTICS_DEEP_LINK =
  'https://t.me/mezfit_bot?startapp=screen_diagnostics';

export function isScreenDiagnosticsStartParam(startParam: string | null): boolean {
  return startParam === SCREEN_DIAGNOSTICS_START_PARAM;
}
