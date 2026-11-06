import { getCapturedTelegramLaunchStartParam } from './bootDiagnostics';

export interface TelegramBackButton {
  show(): void;
  hide(): void;
  onClick(callback: () => void): void;
  offClick(callback: () => void): void;
}

export type TelegramHapticImpactStyle = 'light' | 'medium' | 'heavy' | 'rigid' | 'soft';

export type TelegramHapticNotificationType = 'success' | 'warning' | 'error';

export interface TelegramHapticFeedback {
  selectionChanged(): void;
  impactOccurred?(style: TelegramHapticImpactStyle): void;
  notificationOccurred?(type: TelegramHapticNotificationType): void;
}

export type TelegramHomeScreenStatus = 'unsupported' | 'unknown' | 'added' | 'missed';

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
  addToHomeScreen?(): void;
  checkHomeScreenStatus?(callback?: (status: TelegramHomeScreenStatus) => void): void;
  onEvent?(eventType: 'homeScreenAdded', eventHandler: () => void): void;
  offEvent?(eventType: 'homeScreenAdded', eventHandler: () => void): void;
  BackButton?: TelegramBackButton;
  HapticFeedback?: TelegramHapticFeedback;
}

export function getTelegramWebApp(): TelegramWebApp | null {
  return window.Telegram?.WebApp ?? null;
}

/** Keep native Telegram shortcut events outside React presentation components. */
export function subscribeTelegramHomeScreenStatus(
  onStatus: (status: TelegramHomeScreenStatus) => void,
  onAdded: () => void,
  webApp: TelegramWebApp | null = getTelegramWebApp(),
): () => void {
  if (!webApp?.initData || !webApp.checkHomeScreenStatus || !webApp.addToHomeScreen) {
    return () => {};
  }

  let active = true;
  let added = false;
  let listening = false;
  const handleAdded = () => {
    if (!active) return;
    added = true;
    onAdded();
  };

  try {
    if (webApp.onEvent) {
      webApp.onEvent('homeScreenAdded', handleAdded);
      listening = true;
    }
  } catch {
    // A missing event subscription must not block the status check.
  }

  try {
    webApp.checkHomeScreenStatus((status) => {
      if (active && !added) onStatus(status);
    });
  } catch {
    // A failed native check must not show a speculative reminder.
  }

  return () => {
    active = false;
    if (listening) {
      try {
        webApp.offEvent?.('homeScreenAdded', handleAdded);
      } catch {
        // Cleanup is best-effort on clients with incomplete event support.
      }
    }
  };
}

export function requestTelegramHomeScreenShortcut(
  webApp: TelegramWebApp | null = getTelegramWebApp(),
): void {
  try {
    webApp?.addToHomeScreen?.();
  } catch {
    // A future launch can offer the shortcut again if Telegram reports 'missed'.
  }
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
  // Telegram also includes start_param in the signed initData query string.
  // It is only launch context here; the Worker independently verifies its signature.
  const signedInitDataStartParam = new URLSearchParams(webApp.initData).get('start_param')?.trim();
  return initDataStartParam || signedInitDataStartParam || null;
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
  | 'telegram-success-notification'
  | 'telegram-light-impact'
  | 'telegram-selection'
  | 'none';

export type HapticProbeKind =
  | 'telegram-selection'
  | 'telegram-light-impact'
  | 'telegram-success-notification'
  | 'browser-vibration';

export type HapticProbeResult = 'sent' | 'unsupported' | 'rejected' | 'error';

interface VibrationNavigator {
  vibrate?: (pattern: number | number[]) => boolean;
}

function getDefaultVibrationNavigator(): VibrationNavigator | null {
  return typeof navigator === 'undefined' ? null : navigator;
}

export function getSelectionHapticBackend(
  webApp: TelegramWebApp | null = getTelegramWebApp(),
): SelectionHapticBackend {
  if (typeof webApp?.HapticFeedback?.notificationOccurred === 'function') {
    return 'telegram-success-notification';
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
): void {
  try {
    const haptics = webApp?.HapticFeedback;
    if (!haptics) return;

    if (typeof haptics.notificationOccurred === 'function') {
      haptics.notificationOccurred('success');
      return;
    }

    if (typeof haptics.impactOccurred === 'function') {
      haptics.impactOccurred('light');
      return;
    }

    haptics.selectionChanged();
  } catch {
    // Haptics are a best-effort enhancement and must never block UI interaction.
  }
}

/** Restore the original picker feedback priority on each center crossing:
 *  success notification, light impact, then selectionChanged as fallback. */
export function triggerTelegramPickerSelectionTick(
  webApp: TelegramWebApp | null = getTelegramWebApp(),
): void {
  triggerTelegramSelectionHaptic(webApp);
}

export function runHapticProbe(
  kind: HapticProbeKind,
  webApp: TelegramWebApp | null = getTelegramWebApp(),
  vibrationNavigator: VibrationNavigator | null = getDefaultVibrationNavigator(),
): HapticProbeResult {
  try {
    if (kind === 'browser-vibration') {
      if (typeof vibrationNavigator?.vibrate !== 'function') return 'unsupported';
      return vibrationNavigator.vibrate(50) ? 'sent' : 'rejected';
    }

    const haptics = webApp?.HapticFeedback;
    if (!haptics) return 'unsupported';

    if (kind === 'telegram-selection') {
      haptics.selectionChanged();
      return 'sent';
    }

    if (kind === 'telegram-light-impact') {
      if (typeof haptics.impactOccurred !== 'function') return 'unsupported';
      haptics.impactOccurred('light');
      return 'sent';
    }

    if (typeof haptics.notificationOccurred !== 'function') return 'unsupported';
    haptics.notificationOccurred('success');
    return 'sent';
  } catch {
    return 'error';
  }
}
