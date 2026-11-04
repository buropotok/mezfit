// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { WorkoutReminderSettings } from './WorkoutReminderSettings';

afterEach(cleanup);

describe('role-specific reminder controls', () => {
  it('exposes exactly the athlete reminder in Client mode', () => {
    render(<WorkoutReminderSettings role="client" />);
    expect(screen.getByText('Напоминания о тренировках')).toBeTruthy();
    expect(screen.queryByText('Тренировки с клиентами')).toBeNull();
    expect(screen.queryByText('Мои самостоятельные тренировки')).toBeNull();
  });

  it('exposes two independent controls in Coach mode', () => {
    render(<WorkoutReminderSettings role="coach" />);
    expect(screen.getByText('Тренировки с клиентами')).toBeTruthy();
    expect(screen.getByText('Мои самостоятельные тренировки')).toBeTruthy();
    expect(screen.queryByText('Напоминания о тренировках')).toBeNull();
  });
});
