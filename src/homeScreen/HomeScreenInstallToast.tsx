import { useCallback, useEffect, useState } from 'react';
import { Button, Toast } from 'konsta/react';
import { getTelegramWebApp, type TelegramHomeScreenStatus } from '../telegram';
import { Text } from '../ui/primitives';

const UNKNOWN_PROMPT_DISMISSED_KEY = 'mezfit.homeScreen.unknownPromptDismissed.v1';
const TOAST_DURATION_MS = 10_000;

function unknownPromptWasDismissed(): boolean {
  try {
    return window.localStorage.getItem(UNKNOWN_PROMPT_DISMISSED_KEY) === 'true';
  } catch {
    return false;
  }
}

function rememberUnknownPromptDismissal(): void {
  try {
    window.localStorage.setItem(UNKNOWN_PROMPT_DISMISSED_KEY, 'true');
  } catch {
    // The reminder remains usable if WebView storage is unavailable.
  }
}

export function HomeScreenInstallToast() {
  const [status, setStatus] = useState<TelegramHomeScreenStatus | null>(null);
  const [opened, setOpened] = useState(false);

  const dismiss = useCallback(() => {
    if (status === 'unknown') rememberUnknownPromptDismissal();
    setOpened(false);
  }, [status]);

  useEffect(() => {
    const webApp = getTelegramWebApp();
    if (!webApp?.initData || !webApp.checkHomeScreenStatus || !webApp.addToHomeScreen) return;

    let active = true;
    let listening = false;
    const handleAdded = () => {
      if (!active) return;
      rememberUnknownPromptDismissal();
      setStatus('added');
      setOpened(false);
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
      webApp.checkHomeScreenStatus((nextStatus) => {
        if (!active) return;
        setStatus(nextStatus);
        setOpened(
          nextStatus === 'missed'
          || (nextStatus === 'unknown' && !unknownPromptWasDismissed()),
        );
      });
    } catch {
      // Unsupported/failed native checks never display a speculative reminder.
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
  }, []);

  useEffect(() => {
    if (!opened) return;
    const timer = window.setTimeout(dismiss, TOAST_DURATION_MS);
    return () => window.clearTimeout(timer);
  }, [opened, dismiss]);

  const install = () => {
    // Invoke the Telegram request synchronously from the user's tap.
    dismiss();
    try {
      getTelegramWebApp()?.addToHomeScreen?.();
    } catch {
      // On a subsequent launch, Telegram can report 'missed' again.
    }
  };

  return (
    <Toast
      position="center"
      opened={opened}
      button={(
        <div className="flex shrink-0 items-center gap-1">
          <Button clear rounded small inline onClick={install}>Добавить</Button>
          <Button clear rounded small inline aria-label="Закрыть предложение" onClick={dismiss}>×</Button>
        </div>
      )}
    >
      <Text variant="body">MezFit под рукой</Text>
    </Toast>
  );
}
