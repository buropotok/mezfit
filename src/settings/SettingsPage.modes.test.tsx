// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SettingsPage } from './SettingsPage';

afterEach(() => cleanup());

describe('SettingsPage module modes', () => {
  it('keeps the workout example and opens its existing FACT editor', () => {
    render(<SettingsPage onNavigationContextChange={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Модули' }));
    const workout = screen.getByRole('region', { name: 'Карточка упражнения и подходов' });
    fireEvent.click(within(workout).getByRole('button', { name: 'Открыть подход 1' }));
    expect(screen.getByText('План: 80 кг')).toBeTruthy();
    expect(screen.getByText('Оценка подхода')).toBeTruthy();
    expect(screen.getByText('RPE')).toBeTruthy();
  });

  it('opens a plan editor with previous results but no separate plan or FACT-only controls', () => {
    render(<SettingsPage onNavigationContextChange={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Модули' }));
    const plan = screen.getByRole('region', { name: 'Карточка упражнения и подходов · plan' });
    expect(within(plan).getByText('2 подхода', { exact: false })).toBeTruthy();
    fireEvent.click(within(plan).getByRole('button', { name: 'Открыть подход 3' }));
    expect(screen.getByText('Предыдущая тренировка: 77,5 кг')).toBeTruthy();
    expect(screen.queryByText('План: 80 кг')).toBeNull();
    expect(screen.queryByText('Оценка подхода')).toBeNull();
    expect(screen.queryByText('RPE')).toBeNull();
  });
});
