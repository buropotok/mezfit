import { MezfitDialog, MezfitDialogButton, Text } from '../ui';

/** Temporary entry contract. The legacy D1 editor must not mutate Dexie Cloud records. */
export type CoachExerciseEditorRequest =
  | { mode: 'create'; category: string | null }
  | { mode: 'edit'; exerciseId: string };

export function CoachExerciseEditorGateway({
  request, onClose,
}: {
  request: CoachExerciseEditorRequest | null;
  onClose: () => void;
}) {
  return (
    <MezfitDialog
      opened={request !== null}
      title={request?.mode === 'edit' ? 'Изменить упражнение' : 'Новое упражнение'}
      onBackdropClick={onClose}
      content={<Text>Редактор упражнений будет подключён после переработки модуля. Данные каталога не изменены.</Text>}
      buttons={<MezfitDialogButton onClick={onClose}>Закрыть</MezfitDialogButton>}
    />
  );
}
