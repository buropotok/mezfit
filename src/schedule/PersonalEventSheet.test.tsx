// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import type { PersonalEventRepository } from '../data/cloud/personal-events';
import type { CloudWorkoutOccurrenceRow } from '../data/cloud/workout-foundation-types';
import { PersonalEventSheet } from './PersonalEventSheet';

vi.mock('konsta/react', () => ({
  Button: ({ children, onClick, disabled }: { children: ReactNode; onClick?: () => void; disabled?: boolean }) =>
    <button disabled={disabled} onClick={onClick}>{children}</button>,
}));
vi.mock('../ui', () => ({
  Text: ({ children, variant }: { children: ReactNode; variant?: string }) => <span data-text-variant={variant}>{children}</span>,
  TextInput: ({ label, value, onChange }: { label: string; value: string; onChange: (e: { target: { value: string } }) => void }) =>
    <input aria-label={label} value={value} onChange={onChange} />,
  TextArea: ({ label, value, onChange }: { label: string; value: string; onChange: (e: { target: { value: string } }) => void }) =>
    <textarea aria-label={label} value={value} onChange={onChange} />,
  MezfitBottomSheet: ({ opened, children }: { opened: boolean; children: ReactNode }) =>
    opened ? <div role="dialog">{children}</div> : null,
  DatePicker: ({ opened, onChange }: { opened: boolean; onChange: (date: string) => void }) =>
    opened ? <button onClick={() => onChange('2026-10-30')}>Выбрать 30 октября</button> : null,
  TimePicker: ({ opened, onChange }: { opened: boolean; onChange: (time: string) => void }) =>
    opened ? <button onClick={() => onChange('11:00')}>11:00 из пикера</button> : null,
  MezfitDialog: ({ opened, title, buttons }: { opened: boolean; title: string; buttons: ReactNode }) =>
    opened ? <div role="alertdialog">{title}{buttons}</div> : null,
  MezfitDialogButton: ({ children, onClick }: { children: ReactNode; onClick: () => void }) =>
    <button onClick={onClick}>{children}</button>,
}));

afterEach(cleanup);
const inputEvent: CloudWorkoutOccurrenceRow = {
  id: 'personal-1', realmId: 'tg:101', owner: 'tg:101',
  entryKind: 'personal_event', athleteUserId: 'tg:101', coachUserId: null, clientUserId: null,
  format: 'independent', startsAtUtc: '2026-10-28T09:00:00.000Z',
  durationMinutes: 60, workoutSessionId: null, status: 'scheduled',
  plan: { name: 'Старое название', comment: 'Описание', exercises: [] },
};
function setup(event: CloudWorkoutOccurrenceRow | null = null) {
  const create = vi.fn(async () => 'created-id');
  const update = vi.fn(async () => {});
  const cancel = vi.fn(async () => {});
  const onSaved = vi.fn();
  const onClose = vi.fn();
  const repository = { create, update, cancel } as unknown as PersonalEventRepository;
  const view = render(<PersonalEventSheet opened event={event} date="2026-10-28"
    repository={repository} onClose={onClose} onSaved={onSaved} />);
  return { ...view, create, update, cancel, onSaved, onClose };
}

it('creates a private event using selected calendar date, time and metadata', async () => {
  const f = setup();
  fireEvent.change(screen.getByRole('textbox', { name: 'Название' }), { target: { value: 'Встреча' } });
  fireEvent.change(screen.getByRole('textbox', { name: 'Описание (необязательно)' }), { target: { value: 'Заметка' } });
  fireEvent.click(screen.getByText('2026-10-28'));
  fireEvent.click(screen.getByText('Выбрать 30 октября'));
  fireEvent.click(screen.getByText('Создать событие'));
  await waitFor(() => expect(f.create).toHaveBeenCalledWith({
    title: 'Встреча', notes: 'Заметка', startsAtUtc: expect.any(String), durationMinutes: 60,
  }));
  await waitFor(() => expect(f.onSaved).toHaveBeenCalledOnce());
});

it('edits existing event without generating a new one and confirms cancellation', async () => {
  const f = setup(inputEvent);
  expect(screen.getByRole('textbox', { name: 'Название' })).toHaveProperty('value', 'Старое название');
  fireEvent.change(screen.getByRole('textbox', { name: 'Название' }), { target: { value: 'Новое название' } });
  fireEvent.click(screen.getByText('Сохранить'));
  await waitFor(() => expect(f.update).toHaveBeenCalledWith('personal-1',
    expect.objectContaining({ title: 'Новое название', notes: 'Описание' })));
  expect(f.create).not.toHaveBeenCalled();
  fireEvent.click(screen.getByText('Удалить'));
  expect(screen.getByRole('alertdialog')).not.toBeNull();
  fireEvent.click(screen.getByRole('alertdialog').querySelectorAll('button')[1]!);
  await waitFor(() => expect(f.cancel).toHaveBeenCalledWith('personal-1'));
});

it('uses semantic Body typography for every event-sheet and confirmation button', () => {
  setup(inputEvent);
  const buttons = screen.getByRole('dialog').querySelectorAll('button');
  expect(buttons.length).toBeGreaterThanOrEqual(6);
  for (const button of buttons) {
    expect(button.querySelector('[data-text-variant="body"]')).not.toBeNull();
  }
  fireEvent.click(screen.getByRole('button', { name: 'Удалить' }));
  const dialogButtons = screen.getByRole('alertdialog').querySelectorAll('button');
  expect(dialogButtons).toHaveLength(2);
  for (const button of dialogButtons) {
    expect(button.querySelector('[data-text-variant="body"]')).not.toBeNull();
  }
});
