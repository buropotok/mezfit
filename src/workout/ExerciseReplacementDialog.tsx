import { MezfitDialog, MezfitDialogButton, Text } from '../ui';

export function ExerciseReplacementDialog({ opened, compatible, busy = false, error = '', onCancel, onConfirm }: {
  opened: boolean;
  compatible: boolean;
  busy?: boolean;
  error?: string;
  onCancel: () => void;
  onConfirm: (preserveSets: boolean) => void;
}) {
  return <MezfitDialog opened={opened}
    title={compatible ? 'Сохранить введённые данные?' : 'Сделать замену?'}
    onBackdropClick={busy ? undefined : onCancel}
    buttons={compatible ? <>
      <MezfitDialogButton strong disabled={busy} onClick={() => onConfirm(true)}>Да</MezfitDialogButton>
      <MezfitDialogButton disabled={busy} onClick={() => onConfirm(false)}>Нет</MezfitDialogButton>
      <MezfitDialogButton disabled={busy} onClick={onCancel}>Отмена</MezfitDialogButton>
    </> : <>
      <MezfitDialogButton strong disabled={busy} onClick={() => onConfirm(false)}>Да</MezfitDialogButton>
      <MezfitDialogButton disabled={busy} onClick={onCancel}>Нет</MezfitDialogButton>
    </>}>
    {error ? <Text variant="footnote" role="alert">{error}</Text> : null}
  </MezfitDialog>;
}
