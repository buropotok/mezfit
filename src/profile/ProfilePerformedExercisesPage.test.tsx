// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { ClientPerformedExercisesPage } from './ProfilePerformedExercisesPage';

const probes = vi.hoisted(() => ({ own: vi.fn(), scoped: vi.fn() }));
const db = {};
const fact = {
  key: 'public::press', name: 'Жим лёжа', category: 'chest',
  sessionId: 'personal-session', sessionExerciseId: 'personal-exercise',
  startedAt: new Date().toISOString(), trackingType: 'weight_reps', mediaUrl: null,
  sets: [{ actualReps: 8, actualWeightKg: 60,
    actualDurationSeconds: null, actualDistanceMeters: null }],
};
vi.mock('../data/cloud/CloudConnectionsProvider', () => ({
  useCloudConnections: () => ({ db, actorUserId: 'tg:202' }),
}));
vi.mock('../data/cloud/adhoc-workouts', () => ({
  AdHocWorkoutRepository: class {
    observeOwnExerciseFacts(next: (rows: typeof fact[]) => void) {
      probes.own();
      next([fact]);
      return { unsubscribe: vi.fn() };
    }
    observeClientExerciseFacts(athleteUserId: string, realmId: string) {
      probes.scoped(athleteUserId, realmId);
      return { unsubscribe: vi.fn() };
    }
    exerciseInformation() {
      return Promise.resolve({ row: null, taxonomy: [], name: fact.name, mediaUrl: null });
    }
  },
}));
vi.mock('../ui/Charts', () => ({
  MezfitRadarChart: () => <div>Radar</div>,
  MezfitLineChart: () => <div>Line</div>,
}));
vi.mock('../coach/ClientExerciseStatisticsView', () => ({
  ClientExerciseStatisticsView: () => <div>Статистика упражнения</div>,
}));
vi.mock('../ExerciseMedia', () => ({ ExerciseMedia: () => <span>Превью</span> }));
vi.mock('../program/ProgramExerciseInformationSheet', () => ({
  ProgramExerciseInformationSheet: () => null,
}));
vi.mock('../ui', () => ({
  Text: ({ children }: { children: ReactNode }) => <span>{children}</span>,
  Button: ({ children, ...props }: ButtonHTMLAttributes<HTMLButtonElement>) => <button {...props}>{children}</button>,
  IconButton: ({ children, label, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) =>
    <button aria-label={label} {...props}>{children}</button>,
  GlassSurface: ({ children }: { children: ReactNode }) => <section>{children}</section>,
  List: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ListItem: ({ title, trailing, onClick }: { title: ReactNode; trailing?: ReactNode; onClick: () => void }) =>
    <button onClick={onClick}>{title} {trailing}</button>,
  LiquidPopover: ({ trigger }: { trigger: ReactNode }) => <>{trigger}</>,
}));

afterEach(() => { cleanup(); probes.own.mockClear(); probes.scoped.mockClear(); });

it('uses the athlete-wide FACT read while retaining the Coach exercise page and statistics', () => {
  const navigation = vi.fn();
  render(<ClientPerformedExercisesPage onDetailNavigationChange={navigation} />);
  expect(probes.own).toHaveBeenCalledOnce();
  expect(probes.scoped).not.toHaveBeenCalled();
  expect(screen.getByText('Radar')).toBeTruthy();
  expect(screen.getByRole('button', { name: /^Жим лёжа 1 раз$/ })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: /^Жим лёжа 1 раз$/ }));
  expect(screen.getByText('Статистика упражнения')).toBeTruthy();
  expect(navigation).toHaveBeenCalledWith(expect.objectContaining({
    title: 'Жим лёжа', scrollKey: 'client-exercise:tg:202:public::press',
  }));
});
