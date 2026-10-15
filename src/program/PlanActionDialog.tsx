import { useEffect, useState } from 'react';
import { List, ListInput, ListItem, Radio } from 'konsta/react';
import { MezfitDialog, MezfitDialogButton, Text } from '../ui';

export type PlanDialogOption = { value: string; label: string };
export type PlanDialogState = {
  kind: 'text' | 'weeks' | 'confirm' | 'select';
  title: string;
  description?: string;
  initial?: string;
  options?: readonly PlanDialogOption[];
  confirmLabel?: string;
  destructive?: boolean;
  onConfirm: (value: string) => Promise<void>;
};

export function PlanActionDialog({
  dialog, onClose,
}: { dialog: PlanDialogState | null; onClose: () => void }) {
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    setValue(dialog?.initial ?? dialog?.options?.[0]?.value ?? '');
    setError('');
  }, [dialog]);

  const submit = async () => {
    if (!dialog || busy) return;
    setBusy(true);
    setError('');
    try {
      await dialog.onConfirm(value);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Не удалось сохранить изменения');
    } finally {
      setBusy(false);
    }
  };
  const isValid = Boolean(dialog && (
    dialog.kind === 'confirm' ||
    (dialog.kind === 'text' && value.trim().length > 0 && value.trim().length <= 120) ||
    (dialog.kind === 'weeks' && /^[1-9]\d*$/.test(value) && Number.isSafeInteger(Number(value))) ||
    (dialog.kind === 'select' && dialog.options?.some((item) => item.value === value))
  ));
  return (
    <MezfitDialog
      opened={Boolean(dialog)}
      title={dialog?.title}
      onBackdropClick={!busy ? onClose : undefined}
      role="dialog"
      aria-modal="true"
      aria-label={dialog?.title ?? 'Действие с программой'}
      buttons={(
        <>
          <MezfitDialogButton disabled={busy} onClick={onClose}>Отмена</MezfitDialogButton>
          <MezfitDialogButton strong tone={dialog?.destructive ? 'danger' : 'default'}
            disabled={busy || !isValid} onClick={() => { void submit(); }}>
            {busy ? 'Сохранение…' : dialog?.confirmLabel ?? 'Подтвердить'}
          </MezfitDialogButton>
        </>
      )}
    >
      {dialog?.description ? <Text variant="body">{dialog.description}</Text> : null}
      {dialog?.kind === 'text' ? (
        <List nested>
          <ListInput
            floatingLabel
            inputId="plan-action-text"
            label="Название"
            value={value}
            maxLength={120}
            disabled={busy}
            onChange={(event) => setValue(event.target.value)}
          />
        </List>
      ) : null}
      {dialog?.kind === 'weeks' ? (
        <div className="cloud-plan-dialog-duration">
          <List nested>
            <ListInput
              inputId="plan-action-weeks"
              type="number"
              inputMode="numeric"
              min={1}
              value={value}
              disabled={busy}
              onChange={(event) => setValue(event.target.value)}
            />
          </List>
          <Text variant="body">недель</Text>
        </div>
      ) : null}
      {dialog?.kind === 'select' ? (
        <List nested>
          {dialog.options?.map((option) => (
            <ListItem
              key={option.value}
              label
              title={option.label}
              link
              onClick={() => setValue(option.value)}
              after={<Radio component="div" checked={value === option.value}
                disabled={busy} onChange={() => setValue(option.value)} />}
            />
          ))}
        </List>
      ) : null}
      {error ? <Text variant="footnote" role="alert">{error}</Text> : null}
    </MezfitDialog>
  );
}
