// @vitest-environment jsdom
import type { ReactNode, ChangeEvent } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { UserProfileForm } from './UserProfileForm';

vi.mock('konsta/react', () => ({
  List: ({ children, strong }: { children: ReactNode; strong?: boolean }) => <div data-list-strong={String(strong)}>{children}</div>,
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
  GlassSurface: ({ children, preset, optics, shape, blur }: {
    children: ReactNode; preset: string; optics: boolean; shape: string; blur?: number;
  }) => <section data-profile-glass="" data-preset={preset} data-optics={String(optics)}
    data-shape={shape} data-blur={blur}>{children}</section>,
}));

afterEach(() => cleanup());

describe('user profile form', () => {
  const defaults = { firstName: 'Анна', lastName: 'Иванова' };
  const identity = { initialProfile: null, telegramUserId: '202', telegramUsername: 'anna_fit' };

  it('prefills Telegram fields and uses right-side Mezfit DatePicker for age', async () => {
    const onSave = vi.fn(async () => undefined);
    render(<UserProfileForm defaults={defaults} {...identity} onSave={onSave} />);
    expect((screen.getByLabelText('Имя') as HTMLInputElement).value).toBe('Анна');
    expect((screen.getByLabelText('Фамилия') as HTMLInputElement).value).toBe('Иванова');
    expect(screen.queryByLabelText('Telegram username')).toBeNull();
    expect(screen.getByText('Telegram: @anna_fit')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Выбрать дату рождения' }));
    expect(screen.getByRole('dialog').getAttribute('data-surface')).toBe('panel');
    fireEvent.click(screen.getByRole('button', { name: '31 мая 1990' }));
    expect(screen.getByText(/Возраст:/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Вес, кг'), { target: { value: '63.5' } });
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить анкету' }));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
      firstName: 'Анна', lastName: 'Иванова',
      birthDate: '1990-05-31', weightKg: 63.5,
    })));
  });

  it('does not persist without a birth date', async () => {
    const onSave = vi.fn(async () => undefined);
    render(<UserProfileForm defaults={defaults} {...identity} onSave={onSave} />);
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить анкету' }));
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByText('Укажите корректную дату рождения')).toBeTruthy();
  });
  it('uses only auto-shaped modal glass with inherited blur and transparent Konsta lists', () => {
    const view = render(<UserProfileForm defaults={defaults} {...identity} onSave={async () => {}} />);
    const surfaces = view.container.querySelectorAll('[data-profile-glass]');
    expect(surfaces).toHaveLength(3);
    surfaces.forEach(surface => {
      expect(surface.getAttribute('data-preset')).toBe('modalTuned');
      expect(surface.getAttribute('data-optics')).toBe('false');
      expect(surface.getAttribute('data-shape')).toBe('auto');
      expect(surface.hasAttribute('data-blur')).toBe(false);
    });
    expect(view.container.querySelectorAll('[data-list-strong="false"]')).toHaveLength(3);
  });

  it('edits saved values, preserves the draft on save failure, and allows retry', async () => {
    const onSave = vi.fn().mockRejectedValueOnce(new Error('Не удалось сохранить'))
      .mockResolvedValueOnce(undefined);
    render(<UserProfileForm defaults={defaults} {...identity}
      initialProfile={{ ...defaults, firstName: 'Сохранённое имя', email: '', phone: '', birthDate: '1990-05-31',
        sex: 'undisclosed', weightKg: 62, updatedAt: '2026-11-02T00:00:00Z' }} onSave={onSave} />);
    expect((screen.getByLabelText('Имя') as HTMLInputElement).value).toBe('Сохранённое имя');
    fireEvent.change(screen.getByLabelText('Имя'), { target: { value: 'Новое имя' } });
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить анкету' }));
    await screen.findByText('Не удалось сохранить');
    expect((screen.getByLabelText('Имя') as HTMLInputElement).value).toBe('Новое имя');
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить анкету' }));
    await screen.findByText('Анкета сохранена на устройстве.');
    expect(onSave).toHaveBeenLastCalledWith(expect.objectContaining({ firstName: 'Новое имя' }));
  });

});
