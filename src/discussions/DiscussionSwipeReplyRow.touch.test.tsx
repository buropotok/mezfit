// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createPortal } from 'react-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DiscussionSwipeReplyRow, useDiscussionSwipeVisual } from './DiscussionSwipeReplyRow';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

function finger(identifier: number, clientX: number, clientY = 20) {
  return { identifier, clientX, clientY };
}

function touchStart(target: Element, x: number, id = 17) {
  const item = finger(id, x);
  fireEvent.touchStart(target, { touches: [item], changedTouches: [item] });
}

function documentTouch(type: 'touchmove' | 'touchend' | 'touchcancel', x: number, y = 20, id = 17): Event {
  const touch = finger(id, x, y);
  // A cancelable native event checks the non-passive document listener rather
  // than React's delegated, potentially passive, touchmove handler.
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperties(event, {
    touches: { value: type === 'touchmove' ? [touch] : [] },
    changedTouches: { value: [touch] },
  });
  // Native listeners are outside React's synthetic event dispatcher; flush
  // their state updates before asserting movement or the reply action.
  act(() => { document.dispatchEvent(event); });
  return event;
}

function setup() {
  const reply = vi.fn();
  const view = render(<div role="dialog" aria-label="Обсуждение">
    <DiscussionSwipeReplyRow messageId="incoming" own={false} highlighted={false}
      enabled onReply={reply} rowRef={() => {}}>
      <button type="button">Сообщение</button>
      <input aria-label="Сообщение в редакторе" />
    </DiscussionSwipeReplyRow>
  </div>);
  const row = view.container.querySelector<HTMLElement>('[data-message-id="incoming"]');
  if (!row) throw new Error('Missing message');
  return { ...view, row, reply };
}

describe('native touch swipe inside Telegram WebView-style dialog', () => {
  it('continues moving after pointercancel, caps at 100px and replies once on touchend', () => {
    const { row, reply } = setup();
    touchStart(row, 200);
    const first = documentTouch('touchmove', 182, 21);
    expect(first.defaultPrevented).toBe(true);
    expect(row.style.transform).toBe('translate3d(-18px, 0, 0)');
    // WebView may end its PointerEvent stream without ending the TouchEvent stream.
    fireEvent.pointerCancel(row, { pointerId: 17, pointerType: 'touch', isPrimary: true,
      clientX: 182, clientY: 21 });
    expect(row.style.transform).toBe('translate3d(-18px, 0, 0)');
    documentTouch('touchmove', 85, 22);
    expect(row.style.transform).toBe('translate3d(-100px, 0, 0)');
    expect(reply).not.toHaveBeenCalled();
    documentTouch('touchend', 85, 22);
    expect(reply).toHaveBeenCalledOnce();
    expect(row.style.transform).toBe('');
  });

  it('does not reply when released before 60px, returned rightward or cancelled', () => {
    const { row, reply } = setup();
    touchStart(row, 200, 1);
    documentTouch('touchmove', 141, 20, 1);
    documentTouch('touchend', 141, 20, 1);
    expect(reply).not.toHaveBeenCalled();

    touchStart(row, 200, 2);
    documentTouch('touchmove', 112, 20, 2);
    documentTouch('touchmove', 165, 20, 2);
    documentTouch('touchend', 165, 20, 2);
    expect(reply).not.toHaveBeenCalled();
    expect(row.style.transform).toBe('');

    touchStart(row, 200, 3);
    documentTouch('touchmove', 90, 20, 3);
    documentTouch('touchcancel', 90, 20, 3);
    expect(reply).not.toHaveBeenCalled();
    expect(row.style.transform).toBe('');
  });

  it('leaves native vertical scrolling, right swipes, text input and other pointers alone', () => {
    const { row, reply } = setup();
    touchStart(row, 200, 1);
    const vertical = documentTouch('touchmove', 196, 110, 1);
    expect(vertical.defaultPrevented).toBe(false);
    documentTouch('touchend', 196, 110, 1);
    touchStart(row, 200, 2);
    const right = documentTouch('touchmove', 260, 20, 2);
    expect(right.defaultPrevented).toBe(false);
    documentTouch('touchend', 260, 20, 2);

    const input = screen.getByRole('textbox', { name: 'Сообщение в редакторе' });
    touchStart(input, 200, 3);
    const inputMove = documentTouch('touchmove', 90, 20, 3);
    documentTouch('touchend', 90, 20, 3);
    expect(inputMove.defaultPrevented).toBe(false);
    expect(row.style.transform).toBe('');
    expect(reply).not.toHaveBeenCalled();
  });

  it('cancels the swipe when a second finger appears', () => {
    const { row, reply } = setup();
    touchStart(row, 200, 1);
    documentTouch('touchmove', 130, 20, 1);
    expect(row.style.transform).toBe('translate3d(-70px, 0, 0)');
    fireEvent.touchStart(row, {
      touches: [finger(1, 130), finger(2, 130, 35)],
      changedTouches: [finger(2, 130, 35)],
    });
    expect(row.style.transform).toBe('');
    const noHijack = documentTouch('touchmove', 70, 20, 1);
    expect(noHijack.defaultPrevented).toBe(false);
    documentTouch('touchend', 70, 20, 1);
    expect(reply).not.toHaveBeenCalled();
  });

  it('removes native handlers when the owner unmounts during a gesture', () => {
    const view = setup();
    touchStart(view.row, 200);
    documentTouch('touchmove', 150);
    view.unmount();
    expect(documentTouch('touchmove', 90).defaultPrevented).toBe(false);
    documentTouch('touchend', 90);
    expect(view.reply).not.toHaveBeenCalled();
  });

  it('receives touches initiated in the separate React video-note portal', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const reply = vi.fn();
    function Circle() {
      const offset = useDiscussionSwipeVisual().offsetX;
      return createPortal(<button type="button" data-offset={offset}>Видеокружок</button>, host);
    }
    try {
      const view = render(<DiscussionSwipeReplyRow messageId="note" own={false} highlighted={false}
        enabled onReply={reply} rowRef={() => {}}><Circle /></DiscussionSwipeReplyRow>);
      const row = view.container.querySelector<HTMLElement>('[data-message-id="note"]');
      if (!row) throw new Error('Missing row');
      const circle = screen.getByRole('button', { name: 'Видеокружок' });
      touchStart(circle, 180);
      documentTouch('touchmove', 110);
      expect(row.style.transform).toBe('translate3d(-70px, 0, 0)');
      expect(circle.getAttribute('data-offset')).toBe('-70');
      documentTouch('touchend', 110);
      expect(reply).toHaveBeenCalledOnce();
    } finally {
      host.remove();
    }
  });
});
