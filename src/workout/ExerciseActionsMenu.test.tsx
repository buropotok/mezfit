// @vitest-environment jsdom
import { cloneElement } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { LiquidPopoverProps } from '../ui/LiquidPopover';
import { ExerciseActionsMenu } from './ExerciseActionsMenu';

let finishClosing: (() => void) | undefined;
vi.mock('../ui', async importOriginal => {
  const actual = await importOriginal<typeof import('../ui')>();
  return { ...actual, LiquidPopover: (props: LiquidPopoverProps) => {
    finishClosing = () => props.onPresentationChange?.(false);
    return <>{cloneElement(props.trigger, { onClick: () => props.onOpenChange(!props.isOpen) })}
      {props.isOpen ? <div role="menu">{props.items?.map(item =>
        <button key={item.id} disabled={item.disabled} data-icon={item.icon} onClick={item.onSelect}>{item.label}</button>)}
      </div> : null}</>;
  } };
});
afterEach(() => { cleanup(); finishClosing = undefined; });

it('offers deletion and information with icons, and defers actions until the popover closes', () => {
  const remove = vi.fn(), information = vi.fn();
  render(<ExerciseActionsMenu onDelete={remove} onInformation={information} />);
  fireEvent.click(screen.getByRole('button', { name: 'Меню упражнения' }));
  expect(screen.getByRole('button', { name: 'Удалить' }).getAttribute('data-icon')).toBe('trash-outline');
  expect(screen.getByRole('button', { name: 'Информация' }).getAttribute('data-icon')).toBe('info-circle');
  fireEvent.click(screen.getByRole('button', { name: 'Удалить' }));
  expect(remove).not.toHaveBeenCalled();
  act(() => finishClosing?.());
  expect(remove).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByRole('button', { name: 'Меню упражнения' }));
  fireEvent.click(screen.getByRole('button', { name: 'Информация' }));
  act(() => finishClosing?.());
  expect(information).toHaveBeenCalledOnce();
});

it('keeps information accessible without write permission and blocks deletion', () => {
  render(<ExerciseActionsMenu onInformation={() => {}} />);
  fireEvent.click(screen.getByRole('button', { name: 'Меню упражнения' }));
  expect(screen.getByRole('button', { name: 'Удалить' }).hasAttribute('disabled')).toBe(true);
  expect(screen.getByRole('button', { name: 'Информация' }).hasAttribute('disabled')).toBe(false);
});
