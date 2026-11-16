// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { KonstaProvider } from 'konsta/react';
import { afterEach, expect, it, vi } from 'vitest';
import { DiscussionSheet } from './DiscussionSheet';
import { anchor, fixture, message, thread } from './discussion-fixture.test-support';

vi.mock('../media/discussionMediaCache', async importOriginal => ({
  ...await importOriginal<typeof import('../media/discussionMediaCache')>(),
  readDiscussionMedia: vi.fn(async () => null),
}));
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

function mount(rows = [message('own', 'Мой текст'), message('foreign', 'Чужой текст', 'tg:2', 1)]) {
  const f = fixture(rows);
  const view = render(<KonstaProvider theme="ios" dark>
    <DiscussionSheet opened repository={f.port} threadId={thread.id} anchor={anchor}
      resolveAuthor={userId => ({ name: userId === 'tg:1' ? 'Андрей' : 'Клиент' })}
      onClose={() => {}} parentNavigation={null} onNavigationContextChange={() => {}} />
  </KonstaProvider>);
  return { ...view, ...f };
}
function swipe(element: Element, fromX = 200, toX = 140) {
  fireEvent.pointerDown(element, { pointerId: 10, pointerType: 'touch', isPrimary: true,
    button: 0, clientX: fromX, clientY: 40 });
  fireEvent.pointerMove(element, { pointerId: 10, pointerType: 'touch', isPrimary: true,
    button: 0, clientX: toX, clientY: 42 });
  fireEvent.pointerUp(element, { pointerId: 10, pointerType: 'touch', isPrimary: true,
    button: 0, clientX: toX, clientY: 42 });
}

it('uses the existing Reply action for an incoming text swipe, including marking it read and sending the reply reference', async () => {
  const f = mount();
  await screen.findByText('Чужой текст');
  const row = f.container.querySelector('[data-message-id="foreign"]');
  if (!row) throw new Error('Missing foreign message');
  swipe(row);
  expect(await screen.findByRole('button', { name: 'Перейти к исходному сообщению' })).toBeTruthy();
  await waitFor(() => expect(f.port.markRead).toHaveBeenCalledWith('thread', 'foreign'));
  fireEvent.change(screen.getByPlaceholderText('Сообщение'), { target: { value: 'Ответ жестом' } });
  fireEvent.click(screen.getByRole('button', { name: 'Отправить' }));
  await waitFor(() => expect(f.port.send).toHaveBeenCalledWith(
    expect.objectContaining({ threadId: 'thread', text: 'Ответ жестом', replyToMessageId: 'foreign' }),
  ));
});

it('allows reply by swipe on own messages, without read receipts or deleting them', async () => {
  const f = mount();
  await screen.findByText('Мой текст');
  const row = f.container.querySelector('[data-message-id="own"]');
  if (!row) throw new Error('Missing own message');
  swipe(row);
  expect(await screen.findByRole('button', { name: 'Перейти к исходному сообщению' })).toBeTruthy();
  expect(f.port.remove).not.toHaveBeenCalled();
});

it.each([
  { mediaType: 'photo' as const, mimeType: 'image/jpeg', durationSeconds: null },
  { mediaType: 'video' as const, mimeType: 'video/mp4', durationSeconds: 8 },
  { mediaType: 'video-note' as const, mimeType: 'video/mp4', durationSeconds: 5 },
  { mediaType: 'voice' as const, mimeType: 'audio/ogg', durationSeconds: 3 },
])('replies by left swipe on an incoming $mediaType attachment', async ({ mediaType, mimeType, durationSeconds }) => {
  const source = { ...message('attachment-' + mediaType, '', 'tg:2', 1),
    attachments: [{ id: 'file-' + mediaType, messageId: 'attachment-' + mediaType,
      realmId: thread.realmId, authorUserId: 'tg:2', owner: 'tg:2',
      mediaType, mimeType, sizeBytes: 5, durationSeconds,
      storageKey: 'mvp-media/' + 'a'.repeat(64), uploadState: 'ready' as const,
      confirmedAt: thread.createdAt }],
  };
  const view = mount([source]);
  const row = await waitFor(() => {
    const el = view.container.querySelector('[data-message-id="attachment-' + mediaType + '"]');
    if (!el) throw new Error('Missing attachment row');
    return el;
  });
  if (mediaType === 'video-note') {
    // Circle playback lives in a portal outside the row's DOM but under its React owner.
    const circle = await screen.findByRole('button', { name: 'Открыть видеокружок' });
    swipe(circle);
  } else {
    swipe(row);
  }
  expect(await screen.findByRole('button', { name: 'Перейти к исходному сообщению' })).toBeTruthy();
  expect(view.port.remove).not.toHaveBeenCalled();
});
