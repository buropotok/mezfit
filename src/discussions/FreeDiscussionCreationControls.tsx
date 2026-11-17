import { useId, useState } from 'react';
import { List, ListInput } from 'konsta/react';
import { DISCUSSION_TITLE_MAX_LENGTH } from '../../shared/discussion-anchor';
import { useNavigationFloatingAction, useNavigationSurfaceFloatingAction, type NavigationFloatingAction } from '../NavigationShell';
import { CloudContactsList } from '../contacts/CloudContactsList';
import type { CloudContact } from '../data/cloud/CloudConnectionsProvider';
import { Button, MezfitBottomSheet, MezfitDialog, MezfitDialogButton, MezfitSearchbar, Text } from '../ui';
import { chooseDiscussionContactTitle, createFreeDiscussionTitle } from './useFreeDiscussionCreation';

// Each page mounts only its applicable registration. Unmounting releases only its own action.
export function DiscussionsDestinationFab({ action }: { action: NavigationFloatingAction }) {
  useNavigationFloatingAction('discussions', action);
  return null;
}

export function DiscussionWorkspaceFab({ action }: { action: NavigationFloatingAction }) {
  useNavigationSurfaceFloatingAction(action);
  return null;
}

export function DiscussionContactPicker({ opened, role, contacts, status, onSelect, onClose }: {
  opened: boolean;
  role: 'coach' | 'client';
  contacts: readonly CloudContact[];
  status: 'loading' | 'ready' | 'error';
  onSelect: (contact: CloudContact) => void;
  onClose: () => void;
}) {
  const id = useId();
  const [query, setQuery] = useState('');
  const title = chooseDiscussionContactTitle(role);
  const searchLabel = role === 'coach' ? 'Поиск клиента' : 'Поиск тренера';
  const search = query.trim().toLocaleLowerCase('ru-RU');
  const visible = contacts.filter(contact => contact.displayName.toLocaleLowerCase('ru-RU').includes(search));
  return <MezfitBottomSheet opened={opened} label={title} lazyMount onClosed={() => setQuery('')}>
    <section className="discussion-inbox__contact-picker">
      <header className="discussion-inbox__contact-picker-header">
        <Text variant="headline">{title}</Text>
        <Button variant="secondary" onClick={onClose}>Назад</Button>
      </header>
      <label htmlFor={id} className="sr-only"><Text>{searchLabel}</Text></label>
      <MezfitSearchbar inputId={id} placeholder={searchLabel} glassPreset="modalTuned" glassOptics={false}
        value={query} onChange={event => setQuery(event.currentTarget.value)} onClear={() => setQuery('')} />
      {visible.length ? <CloudContactsList contacts={visible} actionLabel={title} onSelect={onSelect} />
        : <Text role="status">{status === 'loading' && !contacts.length ? 'Загружаем список собеседников…'
          : status === 'error' && !contacts.length ? 'Не удалось загрузить список собеседников.'
            : search ? 'Собеседники не найдены'
              : role === 'coach' ? 'Нет доступных клиентов' : 'Нет доступных тренеров'}</Text>}
    </section>
  </MezfitBottomSheet>;
}

export function FreeDiscussionTitleDialog({ pending, saved, error, onClearError, onSubmit, onClose }: {
  pending: boolean;
  saved: boolean;
  error: string;
  onClearError: () => void;
  onSubmit: (title: string) => void;
  onClose: () => void;
}) {
  const id = useId();
  const [draft, setDraft] = useState('');
  return <MezfitDialog opened title={<Text variant="headline">{createFreeDiscussionTitle}</Text>}
    role="dialog" aria-modal="true" aria-label={createFreeDiscussionTitle} onBackdropClick={pending ? undefined : onClose}
    buttons={<>
      <MezfitDialogButton disabled={pending} onClick={onClose}><Text>{saved ? 'Закрыть' : 'Отмена'}</Text></MezfitDialogButton>
      <MezfitDialogButton strong disabled={pending} onClick={() => onSubmit(draft)}>
        <Text>{pending ? 'Сохранение…' : saved ? 'Повторить назначение' : 'Создать'}</Text>
      </MezfitDialogButton>
    </>}>
    <List nested><ListInput floatingLabel inputId={id}
      label={<label htmlFor={id}><Text variant="footnote">Название чата</Text></label>}
      value={draft} maxLength={DISCUSSION_TITLE_MAX_LENGTH} disabled={pending || saved}
      onChange={event => { setDraft(event.target.value); onClearError(); }} />
    </List>
    {error ? <Text role="alert" variant="footnote">{error}</Text> : null}
  </MezfitDialog>;
}
