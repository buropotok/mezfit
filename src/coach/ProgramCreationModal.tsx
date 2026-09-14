import type { CoachClientListItem } from '../api';
import { Avatar, List, ListItem, Modal, Text, TextInput } from '../ui';
import programIconUrl from '../ui/icons/Untitled_20260914_023702.svg';
import type { ProgramCreationDraft } from './ProgramsPage';

function clientName(client: CoachClientListItem): string {
  return [client.user.firstName, client.user.lastName].filter(Boolean).join(' ');
}

interface ProgramCreationModalProps {
  draft: ProgramCreationDraft | null;
  busy: boolean;
  error: string;
  onCancel: () => void;
  onChange: (draft: ProgramCreationDraft) => void;
  onRequestClientSelection: () => void;
  onSave: () => void;
}

export function ProgramCreationModal({
  draft,
  busy,
  error,
  onCancel,
  onChange,
  onRequestClientSelection,
  onSave,
}: ProgramCreationModalProps) {
  const canSave = Boolean(draft?.name.trim() && draft.owner && !busy);
  const selectedClient = draft?.owner?.type === 'client' ? draft.owner.client : null;

  return (
    <Modal
      isOpen={draft !== null}
      title={<span className="program-create-title"><img src={programIconUrl} alt="" aria-hidden="true" />Создать программу</span>}
      hasCloseButton={false}
      onClose={onCancel}
      actions={[
        { id: 'cancel', label: 'Отмена', onClick: onCancel, disabled: busy },
        { id: 'save', label: busy ? 'Сохранение…' : 'Сохранить', onClick: onSave, disabled: !canSave },
      ]}
    >
      {draft ? (
        <div className="program-create-content">
          <TextInput
            label="Название"
            value={draft.name}
            maxLength={120}
            onChange={(event) => onChange({ ...draft, name: event.target.value })}
          />
          <List>
            <ListItem
              onClick={onRequestClientSelection}
              leading={selectedClient ? <Avatar name={clientName(selectedClient)} src={selectedClient.user.photoUrl ?? undefined} /> : undefined}
              title="Выбрать клиента"
              subtitle={selectedClient ? clientName(selectedClient) : undefined}
            />
            <ListItem
              onClick={() => onChange({ ...draft, owner: { type: 'self' } })}
              title="Моя программа"
              subtitle={draft.owner?.type === 'self' ? 'Выбрано' : undefined}
            />
          </List>
          {error ? <Text variant="footnote" className="programs-error" role="alert">{error}</Text> : null}
        </div>
      ) : null}
    </Modal>
  );
}
