// @vitest-environment jsdom
import type { ReactNode, ChangeEvent } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ClientIntakeForm } from './ClientIntake';

vi.mock('konsta/react', () => ({
  List: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ListInput: ({ label, value, onChange, type = 'text', disabled }: {
    label: string; value: string | number; type?: string; disabled?: boolean;
    onChange: (event: ChangeEvent<HTMLInputElement>) => void;
  }) => <label>{label}<input aria-label={label} type={type}
    value={value} disabled={disabled} onChange={onChange} /></label>,
  ListItem: ({ title, children, media }: { title: string; children: ReactNode; media: ReactNode }) => (
    <div>{title}{media}{children}</div>
  ),
  Radio: ({ checked, onChange, value }: {
    checked: boolean; onChange: () => void; value: string;
  }) => <input type="radio" aria-label={value} checked={checked} onChange={onChange} />,
}));
vi.mock('../ui', () => ({
  Text: ({ children }: { children: ReactNode }) => <span>{children}</span>,
  Button: ({ children, onClick, disabled }: {
    children: ReactNode; onClick?: () => void; disabled?: boolean;
  }) => <button disabled={disabled} onClick={onClick}>{children}</button>,
  DatePicker: ({ opened, surface, onChange }: {
    opened: boolean; surface: string; onChange: (value: string) => void;
  }) => opened ? <div role="dialog" data-surface={surface}>
    <button onClick={() => onChange('1990-05-31')}>31 мая 1990</button>
  </div> : null,
  GlassSurface: ({ children }: { children: ReactNode }) => <section>{children}</section>,
}));
vi.mock('../data/cloud/CloudConnectionsProvider', () => ({ useCloudConnections: () => null }));

afterEach(() => cleanup());

describe('client registration form', () => {
  const defaults = { firstName: 'Анна', lastName: 'Иванова', telegramUsername: 'anna_fit' };

  it('prefills Telegram fields and uses right-side Mezfit DatePicker for age', async () => {
    const onSave = vi.fn(async () => undefined);
    render(<ClientIntakeForm defaults={defaults} onSave={onSave} />);
    expect((screen.getByLabelText('Имя') as HTMLInputElement).value).toBe('Анна');
    expect((screen.getByLabelText('Фамилия') as HTMLInputElement).value).toBe('Иванова');
    expect((screen.getByLabelText('Telegram username') as HTMLInputElement).value).toBe('anna_fit');
    fireEvent.click(screen.getByRole('button', { name: 'Выбрать дату рождения' }));
    expect(screen.getByRole('dialog').getAttribute('data-surface')).toBe('panel');
    fireEvent.click(screen.getByRole('button', { name: '31 мая 1990' }));
    expect(screen.getByText(/Возраст:/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Вес, кг'), { target: { value: '63.5' } });
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить анкету' }));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
      firstName: 'Анна', lastName: 'Иванова', telegramUsername: 'anna_fit',
      birthDate: '1990-05-31', weightKg: 63.5,
    })));
  });

  it('does not persist without a birth date', async () => {
    const onSave = vi.fn(async () => undefined);
    render(<ClientIntakeForm defaults={defaults} onSave={onSave} />);
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить анкету' }));
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByText('Укажите корректную дату рождения')).toBeTruthy();
  });
});
