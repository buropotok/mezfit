/** @vitest-environment jsdom */
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Dropdown, type DropdownOption } from './Dropdown';

const options: DropdownOption[] = [
  { value: 'strength', label: 'Силовая' },
  { value: 'cardio', label: 'Кардио' },
  { value: 'disabled', label: 'Недоступно', disabled: true },
];

describe('Dropdown', () => {
  it('forwards accessible labeling to the trigger', () => {
    render(<Dropdown mode="single" options={options} value="strength" onChange={() => {}} triggerProps={{ 'aria-label': 'Тип тренировки' }} />);

    expect(screen.getByRole('button', { name: 'Тип тренировки' }).getAttribute('aria-haspopup')).toBe('dialog');
  });

  it('selects a single option and closes immediately', () => {
    const onChange = vi.fn();
    render(<Dropdown mode="single" options={options} value="strength" onChange={onChange} triggerProps={{ 'aria-label': 'Тип тренировки' }} />);

    fireEvent.click(screen.getByRole('button', { name: 'Тип тренировки' }));
    fireEvent.click(screen.getByRole('button', { name: 'Кардио' }));

    expect(onChange).toHaveBeenCalledWith('cardio');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('keeps disabled options non-interactive', () => {
    const onChange = vi.fn();
    render(<Dropdown mode="single" options={options} value="strength" onChange={onChange} />);

    fireEvent.click(screen.getByRole('button', { name: 'Силовая' }));
    const disabledOption = screen.getByRole('button', { name: 'Недоступно' });
    expect(disabledOption).toHaveProperty('disabled', true);
    fireEvent.click(disabledOption);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('initializes a fresh multi draft and commits it with OK', () => {
    const onChange = vi.fn();
    const { rerender } = render(<Dropdown mode="multi" options={options} value={['strength']} onChange={onChange} />);

    fireEvent.click(screen.getByRole('button', { name: 'Силовая' }));
    fireEvent.click(screen.getByRole('button', { name: 'Кардио' }));
    fireEvent.click(screen.getByRole('button', { name: 'OK' }));
    expect(onChange).toHaveBeenLastCalledWith(['strength', 'cardio']);

    rerender(<Dropdown mode="multi" options={options} value={['cardio']} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: 'Кардио' }));
    fireEvent.click(screen.getByRole('button', { name: 'OK' }));
    expect(onChange).toHaveBeenLastCalledWith(['cardio']);
  });

  it('commits the current multi draft when closed with the close button', () => {
    const onChange = vi.fn();
    render(<Dropdown mode="multi" options={options} value={['strength']} onChange={onChange} />);

    fireEvent.click(screen.getByRole('button', { name: 'Силовая' }));
    fireEvent.click(screen.getByRole('button', { name: 'Кардио' }));
    fireEvent.click(screen.getByRole('button', { name: 'Закрыть' }));

    expect(onChange).toHaveBeenLastCalledWith(['strength', 'cardio']);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('commits the current multi draft on Escape', () => {
    const onChange = vi.fn();
    render(<Dropdown mode="multi" options={options} value={['strength']} onChange={onChange} />);

    fireEvent.click(screen.getByRole('button', { name: 'Силовая' }));
    fireEvent.click(screen.getByRole('button', { name: 'Кардио' }));
    fireEvent.keyDown(document, { key: 'Escape' });

    expect(onChange).toHaveBeenLastCalledWith(['strength', 'cardio']);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('commits the current multi draft on an outside pointer interaction', () => {
    const onChange = vi.fn();
    render(<div><button type="button">Outside</button><Dropdown mode="multi" options={options} value={['strength']} onChange={onChange} /></div>);
    const outside = screen.getByRole('button', { name: 'Outside' });

    fireEvent.click(screen.getByRole('button', { name: 'Силовая' }));
    fireEvent.click(screen.getByRole('button', { name: 'Кардио' }));
    fireEvent.pointerDown(outside);

    expect(onChange).toHaveBeenLastCalledWith(['strength', 'cardio']);
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
