import { useEffect, useId, useRef, useState } from 'react';
import { List, ListInput } from 'konsta/react';
import { requestTelegramInviteShare } from '../telegram';
import { MezfitDialog, MezfitDialogButton, Text } from '../ui';

export function CoachInviteDialog({ url, onClose }: { url: string | null; onClose: () => void }) {
  const inputId = useId();
  const latestUrl = useRef(url);
  const [actionError, setActionError] = useState('');
  const [copyBusy, setCopyBusy] = useState(false);
  const copyInFlight = useRef(false);

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
        setActionError('Не удалось скопировать ссылку. Выделите её ниже и скопируйте вручную.');
      }
    } finally {
      copyInFlight.current = false;
      setCopyBusy(false);
    }
  };

  return (
    <MezfitDialog
      opened={Boolean(url)}
      title="Пригласить клиента"
      content={<Text variant="body">Отправьте ссылку клиенту в Telegram. Ею могут воспользоваться несколько клиентов в течение 30 дней.</Text>}
      buttons={<>
        <MezfitDialogButton strong onClick={share}>Отправить в Telegram</MezfitDialogButton>
        <MezfitDialogButton disabled={copyBusy} onClick={() => { void copy(); }}>Копировать ссылку</MezfitDialogButton>
      </>}
      onBackdropClick={onClose}
      role="alertdialog"
      aria-modal="true"
      aria-hidden={!url}
      aria-label="Пригласить клиента"
    >
      {actionError && url ? <>
        <Text variant="footnote" className="invite-copy-error error-text" role="alert">{actionError}</Text>
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
