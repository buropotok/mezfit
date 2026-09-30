import { getCapturedTelegramLaunchStartParam } from './bootDiagnostics';

export interface TelegramBackButton {
  show(): void;
  hide(): void;
  onClick(callback: () => void): void;
  offClick(callback: () => void): void;
}

export type TelegramHapticImpactStyle = 'light' | 'medium' | 'heavy' | 'rigid' | 'soft';

export interface TelegramHapticFeedback {
  selectionChanged(): void;
  impactOccurred?(style: TelegramHapticImpactStyle): void;
}

export interface TelegramWebApp {
  initData: string;
  initDataUnsafe?: {
    start_param?: string;
  };
  colorScheme: 'light' | 'dark';
  version?: string;
  platform?: string;
  ready(): void;
  expand(): void;
  disableVerticalSwipes?(): void;
  BackButton?: TelegramBackButton;
  HapticFeedback?: TelegramHapticFeedback;
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


export type SelectionHapticBackend =
  | 'android-vibration'
  | 'telegram-light-impact'
  | 'telegram-selection'
  | 'none';

interface VibrationNavigator {
  vibrate?: (pattern: number | number[]) => boolean;
}

function getDefaultVibrationNavigator(): VibrationNavigator | null {
  return typeof navigator === 'undefined' ? null : navigator;
}

export function getSelectionHapticBackend(
  webApp: TelegramWebApp | null = getTelegramWebApp(),
  vibrationNavigator: VibrationNavigator | null = getDefaultVibrationNavigator(),
): SelectionHapticBackend {
  if (
    webApp?.platform === 'android'
    && typeof vibrationNavigator?.vibrate === 'function'
  ) {
    return 'android-vibration';
  }

  if (typeof webApp?.HapticFeedback?.impactOccurred === 'function') {
    return 'telegram-light-impact';
  }

  if (typeof webApp?.HapticFeedback?.selectionChanged === 'function') {
    return 'telegram-selection';
  }

  return 'none';
}

export function triggerTelegramSelectionHaptic(
  webApp: TelegramWebApp | null = getTelegramWebApp(),
  vibrationNavigator: VibrationNavigator | null = getDefaultVibrationNavigator(),
): void {
  try {
    const backend = getSelectionHapticBackend(webApp, vibrationNavigator);

    if (backend === 'android-vibration') {
      vibrationNavigator?.vibrate?.(12);
      return;
    }

    if (backend === 'telegram-light-impact') {
      webApp?.HapticFeedback?.impactOccurred?.('light');
      return;
    }

    if (backend === 'telegram-selection') {
      webApp?.HapticFeedback?.selectionChanged();
    }
  } catch {
    try {
      webApp?.HapticFeedback?.selectionChanged();
    } catch {
      // Haptics are a best-effort enhancement and must never block UI interaction.
    }
  }
}
