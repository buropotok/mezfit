export interface TelegramWebApp {
  initData: string;
  colorScheme: 'light' | 'dark';
  ready(): void;
  expand(): void;
  disableVerticalSwipes?(): void;
}

export function getTelegramWebApp(): TelegramWebApp | null {
  return window.Telegram?.WebApp ?? null;
}
