// @vitest-environment jsdom
import { StrictMode } from 'react';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { DiscussionCategoryMenu } from './DiscussionCategoryControls';
import { isCategoryId, type CategoryDefinition } from '../data/cloud/discussion-organization';
import { installTextOnlyLayout } from '../ui/liquid-glass-text-only/layout.test-support';

const id = '00000000-0000-4000-8000-000000000001';
if (!isCategoryId(id)) throw Error('Invalid category fixture');
const category: CategoryDefinition = { id, name: 'Своя', order: 0 };
const scope = {};
const edit = vi.fn();
const tick = async () => { await act(async () => { vi.advanceTimersByTime(64); }); };
const button = () => screen.getByRole('button', { name: 'Управление категориями' });
beforeEach(() => {
  vi.useFakeTimers();
  installTextOnlyLayout();
  vi.stubGlobal('matchMedia', () => ({ matches: true }));
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  edit.mockClear();
});

describe('single category menu with real LiquidPopover', () => {
  it.each([undefined, category])('offers only applicable actions for %s', async selected => {
    render(<DiscussionCategoryMenu category={selected} scope={scope} disabled={false} available onEdit={edit} />);
    fireEvent.click(button());
    await tick();
    const menu = screen.getByRole('menu');
    expect(within(menu).getAllByRole('menuitem').map(item => item.textContent)).toEqual(selected
      ? ['Добавить категорию', 'Переименовать категорию', 'Удалить категорию'] : ['Добавить категорию']);
    if (selected) {
      const trash = within(menu).getByRole('menuitem', { name: 'Удалить категорию' }).querySelector('[style*="--ui-color-danger"]');
      expect(trash).toBeTruthy();
    }
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Добавить категорию' }));
    expect(edit).not.toHaveBeenCalled();
    await tick();
    expect(edit).toHaveBeenCalledExactlyOnceWith({ kind: 'create' });
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it.each(['rename', 'remove'] as const)('delivers %s for the selected own category after presentation', async kind => {
    render(<StrictMode><DiscussionCategoryMenu category={category} scope={scope} disabled={false} available onEdit={edit} /></StrictMode>);
    fireEvent.click(button());
    await tick();
    const item = screen.getByRole('menuitem', { name: kind === 'rename' ? 'Переименовать категорию' : 'Удалить категорию' });
    act(() => { fireEvent.click(item); fireEvent.click(item); });
    expect(edit).not.toHaveBeenCalled();
    await tick();
    expect(edit).toHaveBeenCalledExactlyOnceWith({ kind, category });
  });

  it.each(['scope', 'tab', 'pending', 'unmount'] as const)('discards an action whose owner changes during close: %s', async change => {
    const ui = (nextScope: object, key = 'training', disabled = false) =>
      <DiscussionCategoryMenu key={key} category={category} scope={nextScope} disabled={disabled} available onEdit={edit} />;
    const view = render(ui(scope));
    fireEvent.click(button());
    await tick();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Удалить категорию' }));
    if (change === 'unmount') view.unmount();
    else view.rerender(ui(change === 'scope' ? {} : scope, change === 'tab' ? 'personal' : 'training', change === 'pending'));
    await tick();
    expect(edit).not.toHaveBeenCalled();
  });

  it('disables writes while categories are unavailable and prevents reopening during an operation', async () => {
    const view = render(<DiscussionCategoryMenu scope={scope} disabled={false} available={false} onEdit={edit} />);
    fireEvent.click(button());
    await tick();
    const add = screen.getByRole('menuitem', { name: 'Добавить категорию' });
    expect(add).toHaveProperty('disabled', true);
    fireEvent.click(add);
    expect(edit).not.toHaveBeenCalled();
    view.rerender(<DiscussionCategoryMenu scope={scope} disabled available onEdit={edit} />);
    await tick();
    expect(button()).toHaveProperty('disabled', true);
    fireEvent.click(button());
    await tick();
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it.each(['folder-plus.svg', 'edit-outline.svg', 'trash-outline.svg'])('uses stroke 1 artwork for %s', filename => {
    const svg = readFileSync(new URL(`../ui/icons/${filename}`, import.meta.url), 'utf8');
    expect(svg).toContain('stroke-width="1"');
    expect(svg).not.toMatch(/stroke-width="(?:2|1\.5)"/);
  });
});
