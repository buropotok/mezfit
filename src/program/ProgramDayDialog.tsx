import { useEffect, useId, useRef, useState } from 'react';
import { List, ListInput } from 'konsta/react';
import { MezfitDialog, MezfitDialogButton, Text } from '../ui';
import { programMutationMessage } from './programPresentation';

export function ProgramDayDialog({ title, name = '', category = '', comment = '', commentOnly = false,
  onSave, onClose,
}: {
  title: string;
  name?: string;
  category?: string;
  comment?: string;
  commentOnly?: boolean;
  onSave: (value: { name: string; category: string; comment: string }) => Promise<void>;
  onClose: () => void;
}) {
  const id = useId();
  const [draftName, setDraftName] = useState(name);
  const [draftCategory, setDraftCategory] = useState(category);
  const [draftComment, setDraftComment] = useState(comment);
  const [required, setRequired] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const running = useRef(false);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const submit = async () => {
    if (running.current) return;
    if (!commentOnly && !draftName.trim()) { setRequired(true); return; }
    running.current = true;
    setBusy(true);
    setError('');
    try {
      await onSave({ name: draftName.trim(), category: draftCategory.trim(), comment: draftComment.trim() });
      if (alive.current) onClose();
    } catch (reason) {
      if (alive.current) setError(programMutationMessage(reason));
    } finally {
      running.current = false;
      if (alive.current) setBusy(false);
    }
  };
  return <MezfitDialog opened title={title} role="dialog" aria-modal="true" aria-label={title}
    onBackdropClick={busy ? undefined : onClose}
    buttons={<>
      <MezfitDialogButton disabled={busy} onClick={onClose}>Отмена</MezfitDialogButton>
      <MezfitDialogButton strong disabled={busy} onClick={() => { void submit(); }}>
        {busy ? 'Сохранение…' : 'Сохранить'}
      </MezfitDialogButton>
    </>}>
    <List nested>
      {commentOnly ? <ListInput floatingLabel inputId={`${id}-comment`} label="Комментарий"
        type="textarea" value={draftComment} maxLength={4000} disabled={busy}
        onChange={(event) => setDraftComment(event.target.value)} /> : <>
        <ListInput floatingLabel inputId={`${id}-name`}
          label={<label htmlFor={`${id}-name`}>Название</label>}
          value={draftName} maxLength={120} disabled={busy}
          error={required ? 'Обязательно к заполнению' : undefined}
          onChange={(event) => { setDraftName(event.target.value); setRequired(false); setError(''); }} />
        <ListInput floatingLabel inputId={`${id}-category`}
          label={<label htmlFor={`${id}-category`}>Категория</label>}
          placeholder="Напр., силовая, кардио, флекс" value={draftCategory} maxLength={120} disabled={busy}
          onChange={(event) => setDraftCategory(event.target.value)} />
      </>}
    </List>
    {error ? <Text variant="footnote" role="alert">{error}</Text> : null}
  </MezfitDialog>;
}
