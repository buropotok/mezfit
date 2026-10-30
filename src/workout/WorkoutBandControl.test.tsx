// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { cloneElement, forwardRef, useEffect, type ButtonHTMLAttributes, type ReactElement, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useCloudConnections } from '../data/cloud/CloudConnectionsProvider';
import { FlexAttributesRepository } from '../data/cloud/flex-attributes';
import { WorkoutBandControl } from './WorkoutBandControl';

const repoState = vi.hoisted(() => ({ getValues: vi.fn(), setValues: vi.fn() }));
vi.mock('../data/cloud/CloudConnectionsProvider', () => ({ useCloudConnections: vi.fn() }));
vi.mock('../data/cloud/flex-attributes', () => ({
  FlexAttributesRepository: vi.fn(function FlexAttributesRepository() { return repoState; }),
}));
vi.mock('../ui', () => ({
  Text: ({ children }: { children: ReactNode }) => <span>{children}</span>,
  Button: ({ children, onClick, disabled }: ButtonHTMLAttributes<HTMLButtonElement>) =>
    <button onClick={onClick} disabled={disabled}>{children}</button>,
  IconButton: forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & { label: string }>(
    function IconButton({ children, label, disabled, ...rest }, ref) {
      return <button ref={ref} aria-label={label} disabled={disabled} {...rest}>{children}</button>;
    },
  ),
  LiquidPopover: ({ trigger, isOpen, onOpenChange, onPresentationChange, items }: {
    trigger: ReactElement<ButtonHTMLAttributes<HTMLButtonElement>>;
    isOpen: boolean;
    onOpenChange: (open: boolean) => void;
    onPresentationChange?: (presented: boolean) => void;
    items: Array<{ id: string; label: string; icon?: string; iconColor?: string;
      onSelect?: () => void; trailingAction?: { label: string; onSelect: () => void } }>;
  }) => {
    useEffect(() => { onPresentationChange?.(isOpen); }, [isOpen, onPresentationChange]);
    return <>
      {cloneElement(trigger, { onClick: () => onOpenChange(!isOpen) })}
      {isOpen ? <div role="menu">{items.map(item => <div key={item.id}>
        <button onClick={() => { item.onSelect?.(); onOpenChange(false); }}>
          {item.label}
        </button>
        {item.trailingAction ? <button onClick={() => {
          item.trailingAction?.onSelect();
          onOpenChange(false);
        }}>{item.trailingAction.label}</button> : null}
      </div>)}</div> : null}
    </>;
  },
  RangePicker: ({ opened, value, minAllowed, maxAllowed, onChange, footer }: {
    opened: boolean;
    value: { min: number; max: number };
    minAllowed: number;
    maxAllowed: number;
    onChange: (value: { min: number; max: number }) => void;
    footer?: ReactNode;
  }) => opened ? <div role="dialog" aria-label="Диапазон нагрузки резинки">
    <span>{minAllowed}–{maxAllowed}</span>
    <span>{value.min}–{value.max}</span>
    <button onClick={() => onChange({ min: 4, max: 11 })}>Изменить диапазон</button>
    {footer}
  </div> : null,
  GlassBackgroundColorControls: ({ onChange }: {
    onChange: (value: { hue: number; saturation: number; value: number }) => void;
  }) => <button onClick={() => onChange({ hue: 210, saturation: 70, value: 90 })}>
    Выбрать цвет
  </button>,
}));

const db = { cloud: { sync: vi.fn() } };

beforeEach(() => {
  vi.clearAllMocks();
  repoState.getValues.mockResolvedValue([]);
  repoState.setValues.mockResolvedValue(undefined);
  vi.mocked(useCloudConnections).mockReturnValue({ db, actorUserId: 'tg:42' }
    as unknown as NonNullable<ReturnType<typeof useCloudConnections>>);
});
afterEach(() => { cleanup(); });

describe('workout fitness bands', () => {
  it('selects one of five bands by load; the selected ripple gets color and caption', async () => {
    const select = vi.fn();
    const view = render(<WorkoutBandControl selected={null} onSelect={select} />);
    await waitFor(() => expect((screen.getByRole('button', { name: 'Выбрать фитнес-ленту' }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByRole('button', { name: 'Выбрать фитнес-ленту' }));
    expect(screen.getByRole('button', { name: '2–5 кг' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '6–9 кг' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '10–13 кг' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '14–17 кг' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '18–21 кг' })).toBeTruthy();
    expect(screen.queryByText('Фиолетовая')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '6–9 кг' }));
    expect(select).toHaveBeenCalledWith('blue');
    expect(screen.queryByRole('menu')).toBeNull();
    view.rerender(<WorkoutBandControl selected="blue" onSelect={select} />);
    expect(screen.getByText('6–9 кг')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Изменить фитнес-ленту' })
      .querySelector('.set-entry__icon--ripple')?.getAttribute('style')).toContain('color:');
  });

  it('uses persisted local palette overrides instead of hardcoded display values', async () => {
    repoState.getValues.mockResolvedValue([
      { key: 'Band_2_min', valueType: 'number', value: 4 },
      { key: 'Band_2_max', valueType: 'number', value: 11 },
      { key: 'Band_2_color', valueType: 'string', value: '#123ABC' },
    ]);
    render(<WorkoutBandControl selected="blue" onSelect={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('4–11 кг')).toBeTruthy());
    const ripple = screen.getByRole('button', { name: 'Изменить фитнес-ленту' })
      .querySelector('.set-entry__icon--ripple') as HTMLElement;
    expect(ripple.style.color).toBe('rgb(18, 58, 188)');
    expect(repoState.setValues).not.toHaveBeenCalled();
  });

  it('closes a no-change pencil editor without writing preferences or reopening', async () => {
    render(<WorkoutBandControl selected={null} onSelect={vi.fn()} />);
    await waitFor(() => expect((screen.getByRole('button', { name: 'Выбрать фитнес-ленту' }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByRole('button', { name: 'Выбрать фитнес-ленту' }));
    fireEvent.click(screen.getByRole('button', { name: 'Изменить параметры ленты 1' }));
    await waitFor(() => expect(screen.getByRole('dialog', { name: 'Диапазон нагрузки резинки' })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Диапазон нагрузки резинки' })).toBeNull());
    expect(repoState.setValues).not.toHaveBeenCalled();
  });

  it('pencil opens the bounded wheel with the color control below it and saves personal Flex data', async () => {
    render(<WorkoutBandControl selected={null} onSelect={vi.fn()} />);
    await waitFor(() => expect((screen.getByRole('button', { name: 'Выбрать фитнес-ленту' }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByRole('button', { name: 'Выбрать фитнес-ленту' }));
    fireEvent.click(screen.getByRole('button', { name: 'Изменить параметры ленты 2' }));
    await waitFor(() => expect(screen.getByRole('dialog', { name: 'Диапазон нагрузки резинки' })).toBeTruthy());
    expect(screen.getByText('1–30')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Выбрать цвет' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Изменить диапазон' }));
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
    await waitFor(() => expect(repoState.setValues).toHaveBeenCalledOnce());
    expect(FlexAttributesRepository).toHaveBeenCalledWith(db, 'tg:42');
    expect(repoState.setValues).toHaveBeenCalledWith(
      { entityType: 'user', entityId: 'tg:42', realmId: 'tg:42' },
      [{ key: 'Band_2_min', valueType: 'number', value: 4 },
        { key: 'Band_2_max', valueType: 'number', value: 11 }],
    );
  });
});
