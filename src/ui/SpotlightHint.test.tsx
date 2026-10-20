// @vitest-environment jsdom
import { useState } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SpotlightHint, SpotlightTarget, useSpotlightHintPause } from './SpotlightHint';

beforeEach(() => {
  localStorage.clear();
  vi.spyOn(HTMLElement.prototype, 'getClientRects').mockImplementation(function (this: HTMLElement) {
    return (this.hidden ? [] : [this.getBoundingClientRect()]) as unknown as DOMRectList;
  });
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    return DOMRect.fromRect(this.classList.contains('ui-spotlight-hint__target')
      ? { x: 20, y: 240, width: 140, height: 44 }
      : { x: 0, y: 0, width: window.innerWidth, height: window.innerHeight });
  });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); localStorage.clear(); });

function Action() {
  const [open, setOpen] = useState(false);
  return <><button onClick={() => setOpen(true)}>Запланировать</button>{open ? <span>Формат открыт</span> : null}</>;
}
function Pause({ value }: { value: boolean }) { useSpotlightHintPause(value); return null; }
const guide = (userId = 'tg:101', version = 1, enabled = true, paused = false) =>
  <SpotlightHint hintId="pick-day" version={version} userId={userId} enabled={enabled} text="Выберите день">
    <Pause value={paused} />
    <SpotlightTarget><Action /></SpotlightTarget>
    <SpotlightTarget><button>Другой день</button></SpotlightTarget>
  </SpotlightHint>;

describe('reusable spotlight guide', () => {
  it('highlights several real targets and preserves the target action state when dismissed', () => {
    render(guide());
    expect(screen.getByLabelText('Подсказка').querySelectorAll('mask rect')).toHaveLength(3);
    fireEvent.click(screen.getByRole('button', { name: 'Запланировать' }));
    expect(screen.queryByLabelText('Подсказка')).toBeNull();
    expect(screen.getByText('Формат открыт')).toBeTruthy();
    expect(localStorage.length).toBe(0);
  });

  it('closes temporarily and shows again on a new entry', () => {
    const view = render(guide());
    fireEvent.click(screen.getByRole('button', { name: 'Закрыть' }));
    expect(screen.queryByLabelText('Подсказка')).toBeNull();
    view.rerender(guide('tg:101', 1, false));
    view.rerender(guide());
    expect(screen.getByLabelText('Подсказка')).toBeTruthy();
  });

  it('remembers never-show separately for each account and hint version', () => {
    const view = render(guide());
    fireEvent.click(screen.getByRole('button', { name: 'Больше не показывать' }));
    view.unmount();
    const next = render(guide());
    expect(screen.queryByLabelText('Подсказка')).toBeNull();
    next.rerender(guide('tg:202'));
    expect(screen.getByLabelText('Подсказка')).toBeTruthy();
    next.rerender(guide('tg:101', 2));
    expect(screen.getByLabelText('Подсказка')).toBeTruthy();
  });

  it('pauses for nested overlays, without remembering a dismissal', async () => {
    const view = render(guide());
    view.rerender(guide('tg:101', 1, true, true));
    expect(screen.queryByLabelText('Подсказка')).toBeNull();
    view.rerender(guide());
    await waitFor(() => expect(screen.getByLabelText('Подсказка')).toBeTruthy());
    expect(localStorage.length).toBe(0);
  });

  it('does not cover the screen when every target is clipped or missing', () => {
    vi.mocked(HTMLElement.prototype.getBoundingClientRect).mockReturnValue(DOMRect.fromRect({
      x: 0, y: window.innerHeight + 100, width: 140, height: 44,
    }));
    const view = render(guide());
    expect(screen.queryByLabelText('Подсказка')).toBeNull();
    view.rerender(<SpotlightHint hintId="empty" version={1} userId="tg:101" enabled text="Нет целей"><span>Пустая программа</span></SpotlightHint>);
    expect(screen.queryByLabelText('Подсказка')).toBeNull();
  });

  it('dismisses for the current entry even when WebView storage is unavailable', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('denied'); });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('denied'); });
    render(guide());
    fireEvent.click(screen.getByRole('button', { name: 'Больше не показывать' }));
    expect(screen.queryByLabelText('Подсказка')).toBeNull();
  });
});
