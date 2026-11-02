import { useCallback, useEffect, useState } from 'react';
import { Button, Toast } from 'konsta/react';
import { requestTelegramHomeScreenShortcut, subscribeTelegramHomeScreenStatus, type TelegramHomeScreenStatus } from '../telegram';
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

  useEffect(() => subscribeTelegramHomeScreenStatus(
    (nextStatus) => {
      setStatus(nextStatus);
      setOpened(
        nextStatus === 'missed'
        || (nextStatus === 'unknown' && !unknownPromptWasDismissed()),
      );
    },
    () => {
      rememberUnknownPromptDismissal();
      setStatus('added');
      setOpened(false);
    },
  ), []);

  useEffect(() => {
    if (!opened) return;
    const timer = window.setTimeout(dismiss, TOAST_DURATION_MS);
    return () => window.clearTimeout(timer);
  }, [opened, dismiss]);

  const install = () => {
    // Invoke the Telegram request synchronously from the user's tap.
    dismiss();
    requestTelegramHomeScreenShortcut();
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
