// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createPortal } from 'react-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DISCUSSION_REPLY_SWIPE_MAX_PX, DISCUSSION_REPLY_SWIPE_TRIGGER_PX,
  DiscussionSwipeReplyRow, useDiscussionSwipeVisual } from './DiscussionSwipeReplyRow';

afterEach(() => cleanup());

function mount() {
  const reply = vi.fn();
  const click = vi.fn();
  const view = render(<DiscussionSwipeReplyRow messageId="foreign" own={false} highlighted={false}
    enabled onReply={reply} rowRef={() => {}}>
    <button type="button" onClick={click}>Сообщение</button>
  </DiscussionSwipeReplyRow>);
  const row = view.container.querySelector<HTMLElement>('[data-message-id="foreign"]');
  if (!row) throw new Error('Missing swipe row');
  const down = (x: number, y = 20, pointerId = 2) => fireEvent.pointerDown(row,
    { pointerId, pointerType: 'touch', button: 0, isPrimary: true, clientX: x, clientY: y });
  const move = (x: number, y = 20, pointerId = 2) => fireEvent.pointerMove(row,
    { pointerId, pointerType: 'touch', button: 0, isPrimary: true, clientX: x, clientY: y });
  const up = (x: number, y = 20, pointerId = 2) => fireEvent.pointerUp(row,
    { pointerId, pointerType: 'touch', button: 0, isPrimary: true, clientX: x, clientY: y });
  return { ...view, row, reply, click, down, move, up };
}

describe('swipe left to reply', () => {
  it('tracks the finger up to 100 CSS px and replies once at 60 px on release', () => {
    const gesture = mount();
    expect(DISCUSSION_REPLY_SWIPE_MAX_PX).toBe(100);
    expect(DISCUSSION_REPLY_SWIPE_TRIGGER_PX).toBe(60);
    gesture.down(200);
    gesture.move(80);
    expect(gesture.row.style.transform).toBe('translate3d(-100px, 0, 0)');
    expect(gesture.reply).not.toHaveBeenCalled();
    gesture.up(80);
    expect(gesture.reply).toHaveBeenCalledOnce();
    expect(gesture.row.style.transform).toBe('');
    // A synthesized click after swipe must not open the bubble's existing menu.
    fireEvent.click(screen.getByRole('button', { name: 'Сообщение' }));
    expect(gesture.click).not.toHaveBeenCalled();
  });

  it('does not reply below the threshold or if the finger returns before release', () => {
    const gesture = mount();
    gesture.down(180); gesture.move(121); gesture.up(121);
    expect(gesture.reply).not.toHaveBeenCalled();
    gesture.down(180, 20, 3); gesture.move(100, 20, 3); gesture.move(150, 20, 3); gesture.up(150, 20, 3);
    expect(gesture.reply).not.toHaveBeenCalled();
    gesture.down(180, 20, 4); gesture.move(120, 20, 4); gesture.up(120, 20, 4);
    expect(gesture.reply).toHaveBeenCalledOnce();
  });

  it('preserves vertical scrolling, rightward gestures and pointer cancellation', () => {
    const gesture = mount();
    gesture.down(200); gesture.move(135, 125); gesture.up(135, 125);
    expect(gesture.row.style.transform).toBe('');
    gesture.down(100, 20, 3); gesture.move(170, 20, 3); gesture.up(170, 20, 3);
    expect(gesture.row.style.transform).toBe('');
    gesture.down(200, 20, 4); gesture.move(120, 20, 4);
    fireEvent.pointerCancel(gesture.row, { pointerId: 4, pointerType: 'touch', clientX: 120, clientY: 20 });
    expect(gesture.row.style.transform).toBe('');
    expect(gesture.reply).not.toHaveBeenCalled();
  });

  it('disables swiping for tombstones or conflicting composer modes', () => {
    const reply = vi.fn();
    const view = render(<DiscussionSwipeReplyRow messageId="deleted" own={false} highlighted={false}
      enabled={false} onReply={reply} rowRef={() => {}}>Удалено</DiscussionSwipeReplyRow>);
    const row = view.container.querySelector<HTMLElement>('[data-message-id="deleted"]');
    if (!row) throw new Error('Missing disabled row');
    fireEvent.pointerDown(row, { pointerId: 1, pointerType: 'touch', button: 0, clientX: 200, clientY: 20 });
    fireEvent.pointerMove(row, { pointerId: 1, pointerType: 'touch', clientX: 100, clientY: 20 });
    fireEvent.pointerUp(row, { pointerId: 1, pointerType: 'touch', clientX: 100, clientY: 20 });
    expect(reply).not.toHaveBeenCalled();
  });

  it('accepts a swipe inside the DiscussionSheet dialog while respecting nested controls', () => {
    const reply = vi.fn();
    const view = render(<div role="dialog" aria-label="Обсуждение">
      <DiscussionSwipeReplyRow messageId="inside-sheet" own={false} highlighted={false}
        enabled onReply={reply} rowRef={() => {}}>
        <button type="button">Сообщение</button>
        <input aria-label="Ввод" />
      </DiscussionSwipeReplyRow>
    </div>);
    const row = view.container.querySelector<HTMLElement>('[data-message-id="inside-sheet"]');
    if (!row) throw new Error('Missing dialog row');
    fireEvent.pointerDown(row, { pointerId: 5, pointerType: 'touch', button: 0, isPrimary: true, clientX: 200, clientY: 20 });
    fireEvent.pointerMove(row, { pointerId: 5, pointerType: 'touch', isPrimary: true, clientX: 140, clientY: 20 });
    expect(row.style.transform).toBe('translate3d(-60px, 0, 0)');
    fireEvent.pointerUp(row, { pointerId: 5, pointerType: 'touch', isPrimary: true, clientX: 140, clientY: 20 });
    expect(reply).toHaveBeenCalledOnce();

    const input = screen.getByRole('textbox', { name: 'Ввод' });
    fireEvent.pointerDown(input, { pointerId: 6, pointerType: 'touch', button: 0, isPrimary: true, clientX: 200, clientY: 20 });
    fireEvent.pointerMove(input, { pointerId: 6, pointerType: 'touch', isPrimary: true, clientX: 140, clientY: 20 });
    fireEvent.pointerUp(input, { pointerId: 6, pointerType: 'touch', isPrimary: true, clientX: 140, clientY: 20 });
    expect(reply).toHaveBeenCalledOnce();
  });

  it('synchronizes motion with media portaled outside the message row', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const reply = vi.fn();
    function PortalCircle() {
      const visual = useDiscussionSwipeVisual();
      return createPortal(<button type="button" data-offset={visual.offsetX}>Видеокружок</button>, host);
    }
    try {
      const view = render(<DiscussionSwipeReplyRow messageId="circle" own={false} highlighted={false}
        enabled onReply={reply} rowRef={() => {}}><PortalCircle /></DiscussionSwipeReplyRow>);
      const row = view.container.querySelector<HTMLElement>('[data-message-id="circle"]');
      if (!row) throw new Error('Missing circle row');
      const circle = screen.getByRole('button', { name: 'Видеокружок' });
      fireEvent.pointerDown(circle, { pointerId: 9, pointerType: 'touch', button: 0, isPrimary: true, clientX: 200, clientY: 20 });
      fireEvent.pointerMove(circle, { pointerId: 9, pointerType: 'touch', isPrimary: true, clientX: 135, clientY: 20 });
      expect(row.style.transform).toBe('translate3d(-65px, 0, 0)');
      expect(circle.getAttribute('data-offset')).toBe('-65');
      fireEvent.pointerUp(circle, { pointerId: 9, pointerType: 'touch', isPrimary: true, clientX: 135, clientY: 20 });
      expect(reply).toHaveBeenCalledOnce();
      expect(circle.getAttribute('data-offset')).toBe('0');
    } finally {
      host.remove();
    }
  });
});
