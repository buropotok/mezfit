import { useCallback, useId, useLayoutEffect, useRef, useState } from 'react';
import { List, ListInput } from 'konsta/react';
import {
  DISCUSSION_CATEGORY_NAME_MAX_LENGTH,
  DISCUSSION_SYSTEM_CATEGORIES,
  type AssignableDiscussionCategory,
  type CategoryDefinition,
  type ResolvedDiscussionCategory,
} from '../data/cloud/discussion-organization';
import { IconButton, LiquidPopover, MezfitDialog, MezfitDialogButton, Text, type LiquidPopoverItem } from '../ui';

export const categoryTabValue = (category: ResolvedDiscussionCategory) =>
  typeof category === 'string' ? category : `custom:${category.id}`;

export function discussionCategoryTabs(role: 'coach' | 'client', categories: readonly CategoryDefinition[]) {
  const standard = ['training', 'nutrition', 'personal', role === 'coach' ? 'client' : 'coach'] as const;
  return [
    ...standard.map(value => ({ value, label: DISCUSSION_SYSTEM_CATEGORIES[value] })),
    // The repository supplies deterministic ordering, including ties.
    ...categories.map(category => ({ value: categoryTabValue({ kind: 'custom', id: category.id }), label: category.name })),
  ];
}

type CategoryEdit = 'rename' | 'remove';
export type CategoryDialogIntent = { kind: 'create' } | { kind: CategoryEdit; category: CategoryDefinition };
const dialogTitles = { create: 'Новая категория', rename: 'Переименовать категорию', remove: 'Удалить категорию?' };
const dialogActions = { create: 'Создать', rename: 'Сохранить', remove: 'Удалить' };

export const categoryDialogTitle = (intent: CategoryDialogIntent) => dialogTitles[intent.kind];

export function categoryMutationError(reason: unknown, fallback: string): string {
  const code = reason instanceof Error ? reason.message : '';
  switch (code) {
    case 'INVALID_DISCUSSION_CATEGORY_NAME':
      return `Используйте до ${DISCUSSION_CATEGORY_NAME_MAX_LENGTH} символов без управляющих знаков. Системные названия и «+» недоступны.`;
    case 'DUPLICATE_DISCUSSION_CATEGORY_NAME':
      return 'Категория с таким названием уже есть.';
    case 'DISCUSSION_CATEGORY_NOT_FOUND':
      return 'Эта категория больше недоступна.';
    case 'DISCUSSION_CATEGORIES_INCOMPLETE':
    case 'DISCUSSION_CATEGORY_CLEANUP_INCOMPLETE':
      return 'Данные категорий ещё загружаются. Повторите попытку позже.';
    case 'DISCUSSION_NOT_FOUND':
    case 'DISCUSSION_ACCESS_DENIED':
      return 'Это обсуждение больше недоступно.';
    default:
      return fallback;
  }
}

export function DiscussionCategoryDialog({ intent, pending, error, onClearError, onSubmit, onClose }: {
  intent: CategoryDialogIntent;
  pending: boolean;
  error: string;
  onClearError: () => void;
  onSubmit: (name: string) => void;
  onClose: () => void;
}) {
  const inputId = useId();
  const [draft, setDraft] = useState(intent.kind === 'rename' ? intent.category.name : '');
  const [required, setRequired] = useState(false);
  const title = categoryDialogTitle(intent);
  const submit = () => {
    const name = draft.trim();
    if (intent.kind !== 'remove' && !name) { setRequired(true); return; }
    onSubmit(name);
  };

  return <MezfitDialog opened title={<Text variant="headline">{title}</Text>}
    role={intent.kind === 'remove' ? 'alertdialog' : 'dialog'} aria-modal="true" aria-label={title}
    onBackdropClick={pending ? undefined : onClose}
    buttons={<>
      <MezfitDialogButton disabled={pending} onClick={onClose}><Text>Отмена</Text></MezfitDialogButton>
      <MezfitDialogButton strong tone={intent.kind === 'remove' ? 'danger' : 'default'} disabled={pending} onClick={submit}>
        <Text>{pending ? 'Сохранение…' : dialogActions[intent.kind]}</Text>
      </MezfitDialogButton>
    </>}>
    {intent.kind === 'remove' ? <Text>Категория «{intent.category.name}» будет удалена. Чаты и сообщения сохранятся.</Text>
      : <List nested><ListInput floatingLabel inputId={inputId}
        label={<label htmlFor={inputId}><Text variant="footnote">Название</Text></label>}
        value={draft} disabled={pending}
        onChange={event => { setDraft(event.target.value); setRequired(false); onClearError(); }} />
      </List>}
    {required || error ? <Text variant="footnote" role="alert">{required ? 'Введите название категории.' : error}</Text> : null}
  </MezfitDialog>;
}

export function DiscussionCategoryMenu({ category, disabled, onEdit }: {
  category: CategoryDefinition;
  disabled: boolean;
  onEdit: (intent: CategoryDialogIntent) => void;
}) {
  const trigger = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const requestedAction = useRef<CategoryEdit | null>(null);
  useLayoutEffect(() => () => { requestedAction.current = null; }, []);
  const label = `Управление категорией: ${category.name}`;
  return <LiquidPopover isOpen={open} onOpenChange={setOpen} triggerRef={trigger} label={label}
    trigger={<IconButton size="compact" ref={trigger} icon="dots-vertical" label={label} disabled={disabled} />}
    onPresentationChange={presented => {
      if (presented || !requestedAction.current) return;
      const kind = requestedAction.current;
      requestedAction.current = null;
      onEdit({ kind, category });
    }}
    items={[
      { id: 'rename', label: 'Переименовать', icon: 'pencil', onSelect: () => { requestedAction.current = 'rename'; } },
      { id: 'remove', label: 'Удалить категорию', icon: 'trash-outline', onSelect: () => { requestedAction.current = 'remove'; } },
    ]} />;
}

interface DiscussionMoveActions {
  categories: readonly CategoryDefinition[];
  disabled: boolean;
}

export function DiscussionMoveMenu({ title, free, actions, onMove }: {
  title: string;
  free: boolean;
  actions: DiscussionMoveActions;
  onMove: (category: AssignableDiscussionCategory | null) => void;
}) {
  const trigger = useRef<HTMLButtonElement>(null);
  const [menu, setMenu] = useState<'closed' | 'open' | 'closing'>('closed');
  const onPresentationChange = useCallback((presented: boolean) => {
    if (!presented) setMenu(current => current === 'closing' ? 'closed' : current);
  }, []);
  const label = `Переместить в категорию: ${title}`;
  const button = <IconButton size="compact" ref={trigger} icon="dots-vertical" label={label} disabled={actions.disabled}
    aria-haspopup="menu" aria-expanded={menu === 'open'} onClick={menu === 'closed' ? () => setMenu('open') : undefined} />;
  // A closed thread row needs only its trigger. Mount the popover's
  // measurement and canvas work on demand and retain its closing presentation.
  if (menu === 'closed') return button;
  const items: LiquidPopoverItem[] = [
    {
      id: 'clear', label: free ? 'Без категории / по умолчанию' : DISCUSSION_SYSTEM_CATEGORIES.training,
      onSelect: () => onMove(null),
    },
    ...(['nutrition', 'personal'] as const).map(category => ({
      id: category, label: DISCUSSION_SYSTEM_CATEGORIES[category], onSelect: () => onMove(category),
    })),
    ...actions.categories.map(({ id, name }) => ({ id, label: name, onSelect: () => onMove({ kind: 'custom', id }) })),
  ];
  return <LiquidPopover isOpen={menu === 'open'} onOpenChange={open => setMenu(open ? 'open' : 'closing')}
    onPresentationChange={onPresentationChange} triggerRef={trigger} label={label} trigger={button} items={items} />;
}
