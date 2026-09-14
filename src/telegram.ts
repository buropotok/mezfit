export interface TelegramWebApp {
  initData: string;
  colorScheme: 'light' | 'dark';
  version?: string;
  platform?: string;
  ready(): void;
  expand(): void;
}

export function getTelegramWebApp(): TelegramWebApp | null {
  return window.Telegram?.WebApp ?? null;
}
