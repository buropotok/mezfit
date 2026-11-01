// @vitest-environment jsdom
import { cloneElement, type ButtonHTMLAttributes, type ReactElement, type ReactNode } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ClientPerformedExercisesPage } from './ClientPerformedExercisesPage';

const fakeDb = vi.hoisted(() => ({}));
const performed = vi.hoisted(() => [
  { key: 'public::bench', name: 'Жим лёжа', category: 'chest',
    sessionId: 's1', sessionExerciseId: 'e1', startedAt: new Date().toISOString(),
    trackingType: 'weight_reps', mediaUrl: '/media/bench.gif',
    sets: [{ actualReps: 8, actualWeightKg: 60, actualDurationSeconds: null, actualDistanceMeters: null }] },
  { key: 'public::squat', name: 'Приседания', category: 'legs',
    sessionId: 's1', sessionExerciseId: 'e2', startedAt: new Date().toISOString(),
    trackingType: 'weight_reps', mediaUrl: '/media/squat.gif',
    sets: [{ actualReps: 5, actualWeightKg: 70, actualDurationSeconds: null, actualDistanceMeters: null }] },
]);
const exerciseInfo = vi.hoisted(() => vi.fn(async (_sessionId: string, _exerciseId: string) => ({ row: null, taxonomy: [], name: 'Жим', mediaUrl: null })));
vi.mock('../data/cloud/CloudConnectionsProvider', () => ({
  useCloudConnections: () => ({ db: fakeDb, actorUserId: 'tg:101' }),
}));
vi.mock('../data/cloud/adhoc-workouts', () => ({
  AdHocWorkoutRepository: class {
    observeClientExerciseFacts(_athlete: string, _realm: string, onChange: (rows: typeof performed) => void) {
      onChange(performed);
      return { unsubscribe() {} };
    }
    exerciseInformation(sessionId: string, exerciseId: string) {
      return exerciseInfo(sessionId, exerciseId);
    }
  },
}));
vi.mock('../ui/Charts', () => ({
  MezfitRadarChart: () => <div>Radar</div>,
  MezfitLineChart: () => <div>Line</div>,
}));
vi.mock('./ClientExerciseStatisticsView', () => ({
  ClientExerciseStatisticsView: () => <div>Статистика упражнения</div>,
}));
vi.mock('../ExerciseMedia', () => ({
  ExerciseMedia: ({ sourceUrl }: { sourceUrl: string }) => <img src={sourceUrl} alt="" />,
}));
vi.mock('../program/ProgramExerciseInformationSheet', () => ({
  ProgramExerciseInformationSheet: ({ onClose }: { onClose: () => void }) => (
    <div role="dialog" aria-label="Информация об упражнении">
      <button onClick={onClose}>Закрыть описание</button>
    </div>
  ),
}));
vi.mock('../ui', () => ({
  Text: ({ children }: { children: ReactNode }) => <span>{children}</span>,
  Button: ({ children, ...props }: ButtonHTMLAttributes<HTMLButtonElement>) => <button {...props}>{children}</button>,
  IconButton: ({ children, label, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) =>
    <button aria-label={label} {...props}>{children}</button>,
  GlassSurface: ({ children, component, onClick, 'aria-label': ariaLabel }: {
    children: ReactNode; component?: string; onClick?: () => void; 'aria-label'?: string;
  }) => component === 'button'
    ? <button onClick={onClick} aria-label={ariaLabel}>{children}</button>
    : <section>{children}</section>,
  List: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ListItem: ({ title, trailing, onClick }: { title: ReactNode; trailing?: ReactNode; onClick: () => void }) =>
    <button onClick={onClick}>{title} {trailing}</button>,
  LiquidPopover: ({ trigger, items, isOpen, onOpenChange }: {
    trigger: ReactElement<{ onClick?: () => void }>;
    items: { id: string; label: string; onSelect?: () => void }[];
    isOpen: boolean; onOpenChange: (next: boolean) => void;
  }) => <div>
    {cloneElement(trigger, { onClick: () => onOpenChange(!isOpen) })}
    {isOpen ? items.map(item => <button key={item.id} onClick={() => {
      item.onSelect?.(); onOpenChange(false);
    }}>{item.label}</button>) : null}
  </div>,
}));

afterEach(() => { cleanup(); exerciseInfo.mockClear(); });

describe('coach client exercise history interactions', () => {
  const client = { userId: 'tg:202', relationshipId: 'realm-202',
    telegramUserId: '202', displayName: 'Анна' };

  it('filters the list through the funnel LiquidPopover, not the Radar diagram', () => {
    render(<ClientPerformedExercisesPage client={client} />);
    expect(screen.getByText('Radar')).toBeTruthy();
    expect(screen.getByRole('button', { name: /^Жим лёжа 1 раз$/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /^Приседания 1 раз$/ })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Фильтр по категориям' }));
    fireEvent.click(screen.getByRole('button', { name: 'Грудь' }));
    expect(screen.getByRole('button', { name: /^Жим лёжа 1 раз$/ })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^Приседания 1 раз$/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Фильтр по категориям' }));
    fireEvent.click(screen.getByRole('button', { name: 'Все категории' }));
    expect(screen.getByRole('button', { name: /^Приседания 1 раз$/ })).toBeTruthy();
  });

  it('prevents navigating into future rolling windows while allowing earlier periods', () => {
    render(<ClientPerformedExercisesPage client={client} />);
    fireEvent.click(screen.getByRole('button', { name: /Период: 30 дней/ }));
    fireEvent.click(screen.getByRole('button', { name: '3 месяца' }));
    expect((screen.getByRole('button', { name: 'Следующий период' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Предыдущий период' }));
    expect((screen.getByRole('button', { name: 'Следующий период' }) as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Следующий период' }));
    expect((screen.getByRole('button', { name: 'Следующий период' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('opens the reused information sheet only from GIF, while name opens statistics', () => {
    render(<ClientPerformedExercisesPage client={client} onDetailNavigationChange={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Информация об упражнении: Жим лёжа' }));
    expect(screen.getByRole('dialog', { name: 'Информация об упражнении' })).toBeTruthy();
    expect(screen.queryByText('Статистика упражнения')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Закрыть описание' }));
    fireEvent.click(screen.getByRole('button', { name: /^Жим лёжа 1 раз$/ }));
    expect(screen.getByText('Статистика упражнения')).toBeTruthy();
  });
});
