// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { MouseEvent, ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MultiExerciseAttributePicker, SingleExerciseAttributePicker } from './ExerciseAttributePicker';

vi.mock('../glassSettings', () => ({
  loadBrowserGlassSettings: () => ({ preset: 'smoked', optics: true, blur: 7 }),
}));

vi.mock('../ui', () => ({
  Text: ({ children }: { children: ReactNode }) => <span>{children}</span>,
  GlassSurface: ({ children, shape, blur, optics, onClick }: {
    children: ReactNode; shape?: string; blur?: number; optics?: boolean;
    onClick?: (event: MouseEvent<HTMLButtonElement>) => void;
  }) => <button data-shape={shape} data-blur={blur} data-optics={String(optics)} onClick={onClick}>
    {children}
  </button>,
  LiquidPopover: ({ trigger, label, isOpen, onOpenChange, selectionMode, preset, optics, blur, items }: {
    trigger: ReactNode; label: string; isOpen: boolean;
    onOpenChange: (value: boolean) => void;
    selectionMode: string; preset: string; optics: boolean; blur: number;
    items: { id: string; label: string; onSelect: () => void }[];
  }) => <section aria-label={label} data-mode={selectionMode} data-preset={preset}
    data-optics={String(optics)} data-blur={blur}>
    {trigger}
    <button onClick={() => onOpenChange(true)}>Показать варианты</button>
    {isOpen ? items.map(item => <button key={item.id} onClick={item.onSelect}>{item.label}</button>) : null}
  </section>,
}));

afterEach(cleanup);

describe('exercise glass attribute picker', () => {
  it('shows Russian values directly on the background and uses saved popover settings', () => {
    render(<SingleExerciseAttributePicker label="Оборудование" value="barbell"
      options={[{ id: 'barbell', label: 'Штанга' }, { id: 'dumbbell', label: 'Гантели' }]}
      onChange={vi.fn()} />);
    const picker = screen.getByRole('region', { name: 'Оборудование' });
    expect(screen.getByText('Штанга')).toBeTruthy();
    const trigger = screen.getByRole('button', { name: 'Выбрать' });
    expect(trigger.getAttribute('data-shape')).toBe('capsule');
    expect(trigger.getAttribute('data-blur')).toBe('0');
    expect(trigger.getAttribute('data-optics')).toBe('false');
    expect(picker.getAttribute('data-mode')).toBe('single');
    expect(picker.getAttribute('data-preset')).toBe('smoked');
    expect(picker.getAttribute('data-blur')).toBe('7');
  });

  it('allows independent muscle combinations and uses the multi-selection primitive', () => {
    const onChange = vi.fn();
    render(<MultiExerciseAttributePicker label="Основные мышцы" value={['chest']}
      options={[{ id: 'chest', label: 'Грудная мышца' }, { id: 'leg', label: 'Мышца бедра' }]}
      onChange={onChange} />);
    expect(screen.getByRole('region', { name: 'Основные мышцы' }).getAttribute('data-mode')).toBe('multi');
    fireEvent.click(screen.getByRole('button', { name: 'Показать варианты' }));
    fireEvent.click(screen.getByRole('button', { name: 'Мышца бедра' }));
    expect(onChange).toHaveBeenCalledWith(['chest', 'leg']);
  });
});
