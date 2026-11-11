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

}));
vi.mock('../ui', () => ({
  Text: ({ children, variant }: { children: ReactNode; variant: string }) => <span data-variant={variant}>{children}</span>,
  Button: ({ children, onClick, disabled }: {
    children: ReactNode; onClick?: () => void; disabled?: boolean;
  }) => <button disabled={disabled} onClick={onClick}>{children}</button>,
  LiquidPopover: ({ trigger, isOpen, items }: { trigger: ReactNode; isOpen: boolean;
    items: Array<{ id: string; label: string; onSelect: () => void }> }) =>
    <>{trigger}{isOpen ? <div role="menu">{items.map(item =>
      <button key={item.id} role="menuitem" onClick={item.onSelect}>{item.label}</button>)}</div> : null}</>,
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

it('resets one override while preserving other unsaved field changes', async () => {
  const profile = { firstName: 'Имя тренера', lastName: 'Иванова', email: '', phone: '',
    birthDate: '', sex: 'undisclosed' as const, weightKg: null, updatedAt: '2026-11-03T00:00:00Z' };
  const onSave = vi.fn(async () => undefined);
  const onReset = vi.fn(async () => ({ ...profile, firstName: 'Анна' }));
  render(<UserProfileForm purpose="contact" defaults={{ firstName: '', lastName: '' }}
    initialProfile={profile} telegramUserId="202" telegramUsername={null}
    overridden={['firstName']} onReset={onReset} onSave={onSave} />);
  fireEvent.change(screen.getByLabelText('Имя'), { target: { value: 'Черновик имени' } });
  fireEvent.change(screen.getByLabelText('E-mail'), { target: { value: 'draft@example.com' } });
  fireEvent.click(screen.getByRole('button', { name: 'Сбросить: Имя' }));
  await waitFor(() => expect(screen.getByLabelText('Имя')).toHaveProperty('value', 'Анна'));
  expect(screen.getByLabelText('E-mail')).toHaveProperty('value', 'draft@example.com');
  fireEvent.click(screen.getByRole('button', { name: 'Сохранить переопределения' }));
  await waitFor(() => expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ firstName: 'Анна', email: 'draft@example.com' }), ['email']));
});

it('preserves a field draft after reset failure and permits retry', async () => {
  const profile = { firstName: 'Имя тренера', lastName: '', email: '', phone: '',
    birthDate: '', sex: 'undisclosed' as const, weightKg: null, updatedAt: '2026-11-03T00:00:00Z' };
  const onReset = vi.fn().mockRejectedValueOnce(new Error('quota')).mockResolvedValueOnce({ ...profile, firstName: 'Анна' });
  render(<UserProfileForm purpose="contact" defaults={{ firstName: '', lastName: '' }}
    initialProfile={profile} telegramUserId="202" telegramUsername={null}
    overridden={['firstName']} onReset={onReset} onSave={async () => undefined} />);
  fireEvent.change(screen.getByLabelText('Имя'), { target: { value: 'Черновик' } });
  fireEvent.click(screen.getByRole('button', { name: 'Сбросить: Имя' }));
  await screen.findByText('Не удалось сбросить переопределение. Повторите действие.');
  expect(screen.getByLabelText('Имя')).toHaveProperty('value', 'Черновик');
  fireEvent.click(screen.getByRole('button', { name: 'Сбросить: Имя' }));
  await waitFor(() => expect(screen.getByLabelText('Имя')).toHaveProperty('value', 'Анна'));
});

describe('user profile form', () => {
  const defaults = { firstName: 'Анна', lastName: 'Иванова' };
  const identity = { initialProfile: null, telegramUserId: '202', telegramUsername: 'anna_fit' };

  it('prefills Telegram fields and uses right-side Mezfit DatePicker for age', async () => {
    const onSave = vi.fn(async () => undefined);
    render(<UserProfileForm defaults={defaults} {...identity} onSave={onSave} />);
    expect((screen.getByLabelText('Имя') as HTMLInputElement).value).toBe('Анна');
    expect((screen.getByLabelText('Фамилия') as HTMLInputElement).value).toBe('Иванова');
    expect(screen.queryByLabelText('Telegram username')).toBeNull();
    expect(screen.getByText('@anna_fit')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Выбрать дату рождения' }));
    expect(screen.getByRole('dialog').getAttribute('data-surface')).toBe('panel');
    fireEvent.click(screen.getByRole('button', { name: '31 мая 1990' }));
    const ageLabel = screen.getByText('Возраст');
    expect(ageLabel.getAttribute('data-variant')).toBe('caption');
    expect(ageLabel.nextElementSibling?.getAttribute('data-variant')).toBe('headline');
    fireEvent.change(screen.getByLabelText('Вес, кг'), { target: { value: '63.5' } });
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить анкету' }));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
      firstName: 'Анна', lastName: 'Иванова',
      birthDate: '1990-05-31', weightKg: 63.5,
    })));
  });

  it('saves an entirely empty questionnaire with system Telegram identity kept outside the draft', async () => {
    const onSave = vi.fn(async () => undefined);
    render(<UserProfileForm defaults={{ firstName: '', lastName: '' }} {...identity} onSave={onSave} />);
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить анкету' }));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith({
      firstName: '', lastName: '', email: '', phone: '', birthDate: '', sex: 'undisclosed', weightKg: null,
    }));
    expect(screen.getByText('202')).toBeTruthy();
  });

  it('allows a previously entered birth date to be cleared', async () => {
    const onSave = vi.fn(async () => undefined);
    render(<UserProfileForm defaults={defaults} {...identity} onSave={onSave} />);
    fireEvent.click(screen.getByRole('button', { name: 'Выбрать дату рождения' }));
    fireEvent.click(screen.getByRole('button', { name: '31 мая 1990' }));
    fireEvent.click(screen.getByRole('button', { name: 'Убрать дату рождения' }));
    expect(screen.queryByText('Возраст')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить анкету' }));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ birthDate: '' })));
  });
  it('uses only auto-shaped modal glass with inherited blur and transparent Konsta lists', () => {
    const view = render(<UserProfileForm defaults={defaults} {...identity} onSave={async () => {}} />);
    const surfaces = view.container.querySelectorAll('[data-profile-glass]');
    expect(surfaces).toHaveLength(2);
    surfaces.forEach(surface => {
      expect(surface.getAttribute('data-preset')).toBe('modalTuned');
      expect(surface.getAttribute('data-optics')).toBe('false');
      expect(surface.getAttribute('data-shape')).toBe('auto');
      expect(surface.hasAttribute('data-blur')).toBe(false);
    });
    expect(view.container.querySelectorAll('[data-list-strong="false"]')).toHaveLength(2);
    expect(surfaces[0].textContent).not.toContain('Telegram ID');
    for (const label of ['Telegram ID', 'Telegram', 'Дата рождения', 'Пол', 'Вес, кг'])
      expect(surfaces[1].textContent).toContain(label);
    expect(surfaces[1].contains(screen.getByLabelText('Вес, кг'))).toBe(true);
  });

  it('keeps the Coach contact editor layout while applying Caption/Headline roles', () => {
    const view = render(<UserProfileForm purpose="contact" defaults={defaults} {...identity}
      onSave={async () => {}} />);
    const surfaces = view.container.querySelectorAll('[data-profile-glass]');
    expect(surfaces).toHaveLength(2);
    expect(surfaces[1].textContent).toContain('Вес, кг');
    expect(surfaces[1].textContent).not.toContain('Telegram ID');
    expect(screen.getByText('Telegram ID').getAttribute('data-variant')).toBe('caption');
    expect(screen.getByText('202').getAttribute('data-variant')).toBe('headline');
  });

  it('uses Caption labels, Headline values and the compact sex popover', () => {
    render(<UserProfileForm defaults={defaults} {...identity} onSave={async () => {}} />);
    for (const label of ['Telegram ID', 'Telegram', 'Дата рождения', 'Пол'])
      expect(screen.getByText(label).getAttribute('data-variant')).toBe('caption');
    expect(screen.getByText('@anna_fit').getAttribute('data-variant')).toBe('headline');
    expect(screen.getByText('202').getAttribute('data-variant')).toBe('headline');
    expect(screen.queryByText(/для расчёта возраста/)).toBeNull();
    expect(screen.queryByRole('radio')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Изменить пол' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Мужской' }));
    expect(screen.queryByRole('menu')).toBeNull();
    expect(screen.getByText('муж').getAttribute('data-variant')).toBe('headline');
  });

  it('edits saved values, preserves the draft on save failure, and allows retry', async () => {
    const onSave = vi.fn().mockRejectedValueOnce(new Error('Не удалось сохранить'))
      .mockResolvedValueOnce(undefined);
    render(<UserProfileForm defaults={defaults} {...identity}
      initialProfile={{ ...defaults, firstName: 'Сохранённое имя', email: '', phone: '', birthDate: '1990-05-31',
        sex: 'undisclosed', weightKg: 62, updatedAt: '2026-11-02T00:00:00Z' }} onSave={onSave} />);
    expect((screen.getByLabelText('Имя') as HTMLInputElement).value).toBe('Сохранённое имя');
    const modified = screen.getByText(/^Изменено:/);
    const save = screen.getByRole('button', { name: 'Сохранить анкету' });
    expect(save.compareDocumentPosition(modified) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Имя'), { target: { value: 'Новое имя' } });
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить анкету' }));
    await screen.findByText('Не удалось сохранить');
    expect((screen.getByLabelText('Имя') as HTMLInputElement).value).toBe('Новое имя');
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить анкету' }));
    await screen.findByText('Анкета сохранена на устройстве.');
    expect(onSave).toHaveBeenLastCalledWith(expect.objectContaining({ firstName: 'Новое имя' }));
  });

});

it('contact edits submit only deliberate fields while preserving a draft across incoming publication', async () => {
  const initialProfile = { firstName: 'Анна', lastName: 'Иванова', email: '', phone: '',
    birthDate: '', sex: 'undisclosed' as const, weightKg: null, updatedAt: '2026-11-02T00:00:00Z' };
  const onSave = vi.fn(async () => undefined);
  const view = render(<UserProfileForm purpose="contact" defaults={{ firstName: '', lastName: '' }}
    initialProfile={initialProfile} telegramUserId="202" telegramUsername={null} onSave={onSave} />);
  expect(screen.getByRole('button', { name: 'Сохранить переопределения' })).toHaveProperty('disabled', true);
  fireEvent.change(screen.getByLabelText('Имя'), { target: { value: 'Моё имя' } });
  view.rerender(<UserProfileForm purpose="contact" defaults={{ firstName: '', lastName: '' }}
    initialProfile={{ ...initialProfile, lastName: 'Новая фамилия' }} telegramUserId="202" telegramUsername={null} onSave={onSave} />);
  expect((screen.getByLabelText('Имя') as HTMLInputElement).value).toBe('Моё имя');
  fireEvent.click(screen.getByRole('button', { name: 'Сохранить переопределения' }));
  await waitFor(() => expect(onSave).toHaveBeenCalledWith(
    expect.objectContaining({ firstName: 'Моё имя' }), ['firstName']));
  expect(screen.queryByText('Telegram')).toBeNull();
  expect(screen.getByText('202')).toBeTruthy();
});

it('contact save failure retains edited values and retries the same field patch', async () => {
  const onSave = vi.fn().mockRejectedValueOnce(new Error('Не удалось записать')).mockResolvedValueOnce(undefined);
  render(<UserProfileForm purpose="contact" defaults={{ firstName: '', lastName: '' }}
    initialProfile={null} telegramUserId="202" telegramUsername={null} onSave={onSave} />);
  fireEvent.change(screen.getByLabelText('Телефон'), { target: { value: '+79991234567' } });
  fireEvent.click(screen.getByRole('button', { name: 'Сохранить переопределения' }));
  await screen.findByText('Не удалось записать');
  expect((screen.getByLabelText('Телефон') as HTMLInputElement).value).toBe('+79991234567');
  fireEvent.click(screen.getByRole('button', { name: 'Сохранить переопределения' }));
  await screen.findByText('Переопределения сохранены на устройстве.');
  expect(onSave).toHaveBeenLastCalledWith(expect.objectContaining({ phone: '+79991234567' }), ['phone']);
});
