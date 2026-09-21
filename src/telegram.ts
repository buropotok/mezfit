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

function launchParamFromUrlPart(value: string): string | undefined {
  const withoutPrefix = value.replace(/^[?#]/, '');
  const queryIndex = withoutPrefix.indexOf('?');
  const query = queryIndex >= 0 ? withoutPrefix.slice(queryIndex + 1) : withoutPrefix;
  return new URLSearchParams(query).get('tgWebAppStartParam') ?? undefined;
}

export function getTelegramStartParam(
  webApp: TelegramWebApp,
  locationSearch?: string,
  locationHash?: string,
): string | undefined {
  const signedStartParam = new URLSearchParams(webApp.initData).get('start_param');
  if (signedStartParam) return signedStartParam;

  const search = locationSearch ?? (typeof window === 'undefined' ? '' : window.location.search);
  const hash = locationHash ?? (typeof window === 'undefined' ? '' : window.location.hash);
  return launchParamFromUrlPart(search) ?? launchParamFromUrlPart(hash);
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
