import { getCapturedTelegramLaunchStartParam } from './bootDiagnostics';

export interface TelegramBackButton {
  show(): void;
  hide(): void;
  onClick(callback: () => void): void;
  offClick(callback: () => void): void;
}

export interface TelegramWebApp {
  initData: string;
  initDataUnsafe?: {
    start_param?: string;
  };
  colorScheme: 'light' | 'dark';
  ready(): void;
  expand(): void;
  disableVerticalSwipes?(): void;
  BackButton?: TelegramBackButton;
}

export function getTelegramWebApp(): TelegramWebApp | null {
  return window.Telegram?.WebApp ?? null;
}

export function getTelegramLaunchStartParam(
  webApp: TelegramWebApp,
  search = typeof window === 'undefined' ? '' : window.location.search,
  hash = typeof window === 'undefined' ? '' : window.location.hash,
): string | null {
  const capturedStartParam = getCapturedTelegramLaunchStartParam()?.trim();
  if (capturedStartParam) return capturedStartParam;

  const searchStartParam = new URLSearchParams(search).get('tgWebAppStartParam')?.trim();
  if (searchStartParam) return searchStartParam;

  const hashStartParam = new URLSearchParams(hash.startsWith('#') ? hash.slice(1) : hash)
    .get('tgWebAppStartParam')
    ?.trim();
  if (hashStartParam) return hashStartParam;

  const initDataStartParam = webApp.initDataUnsafe?.start_param?.trim();
  return initDataStartParam || null;
}

export function prepareTelegramWebApp(webApp: TelegramWebApp): void {
  webApp.ready();
  webApp.expand();
  webApp.disableVerticalSwipes?.();
}

export function bindTelegramBackButton(
  webApp: TelegramWebApp | null,
  active: boolean,
  onBack: () => void,
): () => void {
  const backButton = webApp?.BackButton;
  if (!backButton) return () => {};

  if (!active) {
    backButton.hide();
    return () => {};
  }

  backButton.show();
  backButton.onClick(onBack);
  return () => {
    backButton.offClick(onBack);
    backButton.hide();
  };
}
