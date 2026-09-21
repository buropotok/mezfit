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
  search = window.location.search,
): string | null {
  const urlStartParam = new URLSearchParams(search).get('tgWebAppStartParam')?.trim();
  if (urlStartParam) return urlStartParam;

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
