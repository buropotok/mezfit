export interface TelegramBackButton {
  show(): void;
  hide(): void;
  onClick(callback: () => void): void;
  offClick(callback: () => void): void;
}

export interface TelegramWebApp {
  initData: string;
  colorScheme: 'light' | 'dark';
  ready(): void;
  expand(): void;
  disableVerticalSwipes?(): void;
  BackButton?: TelegramBackButton;
}

export function getTelegramWebApp(): TelegramWebApp | null {
  return window.Telegram?.WebApp ?? null;
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
