// @vitest-environment jsdom
import type { ElementType, ReactNode } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CoachShell } from './CoachShell';

vi.mock('../data/cloud/CloudConnectionsProvider', () => ({
  useCloudConnections: () => ({
    db: {}, actorUserId: 'tg:202',
    status: 'ready',
    error: '',
    clients: [{ relationshipId: 'realm-1', userId: 'tg:101', telegramUserId: '101', displayName: 'Анна Иванова' }],
    refresh: vi.fn(async () => undefined),
  }),
}));

vi.mock('../data/cloud/user-profile', () => ({ UserProfileRepository: class {
  observePublished(_userId: string, _realmId: string, next: (profile: null) => void) {
    next(null); return { unsubscribe() {} };
  }
} }));

// Assert the UIkit public contract without replacing its internal gesture mechanics.
vi.mock('../ui/LiquidGlassTextOnly', () => ({
  LiquidGlassTextOnly: ({ tabs, value, fullWidth, onValueChange }: {
    tabs: ReadonlyArray<{ value: string; label: string }>;
    value: string;
    fullWidth?: boolean;
    onValueChange: (next: string) => void;
  }) => <div role="tablist" data-full-width={String(fullWidth)}>
    {tabs.map((tab) => <button type="button" role="tab" aria-selected={tab.value === value}
      key={tab.value} onClick={() => onValueChange(tab.value)}>{tab.label}</button>)}
  </div>,
}));

vi.mock('../ui/GlassSurface', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../ui/GlassSurface')>();
  return {
    ...actual,
    GlassSurface: ({ component: Component = 'div', preset, optics, blur, shape, className, children }: {
      component?: ElementType;
      preset?: string;
      optics?: boolean;
      blur?: number;
      shape?: string;
      className?: string;
      children: ReactNode;
    }) => <Component className={className} data-glass-preset={preset}
      data-glass-optics={String(optics)} data-glass-blur={blur} data-glass-shape={shape}>{children}</Component>,
  };
});

afterEach(() => cleanup());

describe('Coach client workspace presentation', () => {
  it('uses the full-width Text Only UIkit tabs and modal-tuned glass with an inset content surface', () => {
    render(<CoachShell initData="test-init-data" destination="clients"
      onNavigationContextChange={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Открыть клиента Анна Иванова' }));

    const tablist = screen.getByRole('tablist');
    expect(tablist.getAttribute('data-full-width')).toBe('true');
    expect(screen.getByRole('group', { name: 'Разделы клиента Анна Иванова' }).contains(tablist)).toBe(true);
    expect(screen.getAllByRole('tab')).toHaveLength(6);
    expect(screen.getByRole('tab', { name: 'Основные' }).getAttribute('aria-selected')).toBe('true');

    const surface = screen.getByText('Анкета клиента ещё не опубликована.').closest('section');
    expect(surface?.getAttribute('data-glass-preset')).toBe('modalTuned');
    expect(surface?.getAttribute('data-glass-optics')).toBe('false');
    expect(surface?.getAttribute('data-glass-blur')).toBeNull();
    expect(surface?.getAttribute('data-glass-shape')).toBe('auto');

    fireEvent.click(screen.getByRole('tab', { name: 'История' }));
    expect(screen.getByRole('tab', { name: 'История' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByText('Хронологическая история WorkoutSession появится вместе с PLAN / FACT анализом.')).toBeTruthy();
  });
});
