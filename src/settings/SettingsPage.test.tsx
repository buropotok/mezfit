// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SettingsPage } from './SettingsPage';

afterEach(() => cleanup());

describe('SettingsPage modules gallery', () => {
  it('opens the modules gallery and exposes real workout modules', () => {
    const onNavigationContextChange = vi.fn();
    render(<SettingsPage onNavigationContextChange={onNavigationContextChange} />);

    fireEvent.click(screen.getByRole('button', { name: 'Модули' }));

    expect(screen.getByText('Собранные модули')).toBeTruthy();
    expect(screen.getByText('Карточка упражнения и подходов')).toBeTruthy();
    expect(screen.getByText('Жим штанги лёжа')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Открыть подход 1' })).toBeTruthy();
    expect(onNavigationContextChange).toHaveBeenLastCalledWith(expect.objectContaining({ title: 'Модули' }));
  });
});
