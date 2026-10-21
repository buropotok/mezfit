// @vitest-environment jsdom
import { useRef, useState } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SpotlightHint, SpotlightTarget, SpotlightSurface, useSpotlightHintPause } from './SpotlightHint';

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
    const view = render(guide());
    expect(view.container.querySelectorAll('.ui-spotlight-hint__local-mask mask rect')).toHaveLength(3);
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

function ScrollGuide({ autoScroll = false, paused = false, scrollTo }: {
  autoScroll?: boolean; paused?: boolean; scrollTo?: HTMLElement['scrollTo'];
}) {
  const surface = useRef<HTMLDivElement>(null);
  return <div data-testid="scroll-viewport" style={{ overflowY: 'auto' }}
    ref={node => { if (node && scrollTo) node.scrollTo = scrollTo; }}>
    <SpotlightSurface ref={surface}>
      <SpotlightHint hintId="scroll-target" version={1} userId="tg:101" enabled
        autoScroll={autoScroll} paused={paused} surfaceRef={surface} text="Выберите день">
        <SpotlightTarget><button>Запланировать</button></SpotlightTarget>
      </SpotlightHint>
    </SpotlightSurface>
  </div>;
}

describe('native scrolling and initial target reveal', () => {
  function mockScrollingLayout() {
    let scrollTop = 0;
    vi.mocked(HTMLElement.prototype.getBoundingClientRect).mockImplementation(function (this: HTMLElement) {
      if (this.classList.contains('ui-spotlight-hint__target'))
        return DOMRect.fromRect({ x: 20, y: 100 + 900 - scrollTop, width: 140, height: 44 });
      if (this.classList.contains('ui-spotlight-hint__surface'))
        return DOMRect.fromRect({ x: 0, y: 100 - scrollTop, width: 390, height: 1400 });
      return DOMRect.fromRect({ x: 0, y: 100, width: 390, height: 400 });
    });
    return (value: number) => { scrollTop = value; };
  }

  it('keeps target holes in scrolling content without waiting for scroll-event measurements', () => {
    const move = mockScrollingLayout();
    const view = render(<ScrollGuide />);
    const viewport = screen.getByTestId('scroll-viewport');
    const surface = view.container.querySelector('.ui-spotlight-hint__surface')!;
    const shade = surface.querySelector('.ui-spotlight-hint__local-mask')!;
    expect(shade.parentElement).toBe(surface);
    const hole = shade.querySelectorAll('mask rect')[1];
    expect(hole.getAttribute('y')).toBe('900');
    const calls = vi.mocked(HTMLElement.prototype.getBoundingClientRect).mock.calls.length;
    move(700);
    viewport.scrollTop = 700;
    fireEvent.scroll(viewport);
    // The browser scrolls this SVG with the real target; no JS frame needs to catch up.
    expect(shade.parentElement).toBe(surface);
    expect(hole.getAttribute('y')).toBe('900');
    expect(vi.mocked(HTMLElement.prototype.getBoundingClientRect).mock.calls.length).toBe(calls);
    expect(screen.getByLabelText('Подсказка')).toBeTruthy();
  });

  it('reveals the first target once per entry, independently of the hint preference', () => {
    mockScrollingLayout();
    localStorage.setItem('mezfit:hint:tg%3A101:scroll-target:1', 'hidden');
    const scrollTo = vi.fn();
    const view = render(<ScrollGuide autoScroll scrollTo={scrollTo} />);
    expect(scrollTo).toHaveBeenCalledTimes(1);
    expect(scrollTo).toHaveBeenCalledWith(expect.objectContaining({ top: 722 }));
    expect(screen.queryByLabelText('Подсказка')).toBeNull();
    view.rerender(<ScrollGuide autoScroll paused scrollTo={scrollTo} />);
    view.rerender(<ScrollGuide autoScroll scrollTo={scrollTo} />);
    expect(scrollTo).toHaveBeenCalledTimes(1);
    view.unmount();
    render(<ScrollGuide autoScroll scrollTo={scrollTo} />);
    expect(scrollTo).toHaveBeenCalledTimes(2);
  });
});
