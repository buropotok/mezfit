import { useEffect, useId, useRef, useState } from 'react';
import { List, ListInput } from 'konsta/react';
import { requestTelegramInviteShare } from '../telegram';
import { MezfitDialog, MezfitDialogButton, Text } from '../ui';

// Legacy synchronous clipboard fallback for Telegram WebViews that reject Clipboard API writes.
function copyTextUsingSelection(value: string): boolean {
  if (typeof document === 'undefined' || typeof document.execCommand !== 'function') return false;

  const field = document.createElement('textarea');
  field.value = value;
  field.readOnly = true;
  field.tabIndex = -1;
  field.setAttribute('aria-hidden', 'true');
  field.style.position = 'fixed';
  field.style.left = '0';
  field.style.top = '0';
  field.style.opacity = '0';
  document.body.appendChild(field);

  try {
    field.focus();
    field.select();
    field.setSelectionRange(0, field.value.length);
    return document.execCommand('copy');
  } catch {
    return false;
  } finally {
    field.remove();
  }
}

export function CoachInviteDialog({
  url, onClose, previewManualFallback = false,
}: { url: string | null; onClose: () => void; previewManualFallback?: boolean }) {
  const inputId = useId();
  const latestUrl = useRef(url);
  const [actionError, setActionError] = useState('');
  const [copyBusy, setCopyBusy] = useState(false);
  const copyInFlight = useRef(false);
  const fallbackMessage = actionError || (previewManualFallback
    ? 'Не удалось скопировать ссылку. Попробуйте «Скопировать текст» или выделите её ниже.'
    : '');
  const showManualFallback = Boolean(url && fallbackMessage);

  useEffect(() => {
    latestUrl.current = url;
    setActionError('');
    return () => { latestUrl.current = null; };
  }, [url]);

  const share = () => {
    if (!url) return;
    setActionError('');
    if (!requestTelegramInviteShare(url)) {
      setActionError('Не удалось открыть отправку в Telegram. Скопируйте ссылку или выделите её ниже.');
    }
  };

  const copy = async () => {
    if (!url || copyInFlight.current) return;
    copyInFlight.current = true;
    setCopyBusy(true);
    setActionError('');
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
      await navigator.clipboard.writeText(url);
      if (latestUrl.current === url) onClose();
    } catch {
      if (latestUrl.current === url) {
        if (copyTextUsingSelection(url)) onClose();
        else setActionError('Не удалось скопировать ссылку. Попробуйте «Скопировать текст» или выделите её ниже.');
      }
    } finally {
      copyInFlight.current = false;
      setCopyBusy(false);
    }
  };

  const copyVisibleText = () => {
    if (!url || copyBusy || latestUrl.current !== url) return;
    if (copyTextUsingSelection(url)) onClose();
    else setActionError('Автоматическое копирование недоступно. Выделите ссылку ниже и скопируйте вручную.');
  };

  return (
    <MezfitDialog
      opened={Boolean(url)}
      title="Пригласить клиента"
      content={<Text variant="body">Отправьте ссылку клиенту в Telegram. Ею могут воспользоваться несколько клиентов в течение 30 дней.</Text>}
      buttons={<>
        {!previewManualFallback ? <>
          <MezfitDialogButton strong onClick={share}>Отправить в Telegram</MezfitDialogButton>
          <MezfitDialogButton disabled={copyBusy} onClick={() => { void copy(); }}>Копировать ссылку</MezfitDialogButton>
        </> : null}
        {showManualFallback ? <MezfitDialogButton disabled={copyBusy} onClick={copyVisibleText}>Скопировать текст</MezfitDialogButton> : null}
      </>}
      onBackdropClick={onClose}
      role="alertdialog"
      aria-modal="true"
      aria-hidden={!url}
      aria-label="Пригласить клиента"
    >
      {showManualFallback && url ? <>
        <Text variant="footnote" className="invite-copy-error error-text" role="alert">{fallbackMessage}</Text>
        <List nested>
          <ListInput
            inputId={inputId}
            label={<label htmlFor={inputId}>Ссылка-приглашение</label>}
            type="text"
            readOnly
            value={url}
            onFocus={(event) => event.currentTarget.select()}
          />
        </List>
      </> : null}
    </MezfitDialog>
  );
}
