// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { KonstaProvider } from 'konsta/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { LiquidPopoverProps } from '../ui/LiquidPopover';
import type { DiscussionAttachmentSaveTarget } from './DiscussionVideoSaveDialog';
import { DiscussionSheet } from './DiscussionSheet';
import { anchor, fixture, message, thread } from './discussion-fixture.test-support';

vi.mock('../ui/LiquidPopover', () => ({
  LiquidPopover: ({ isOpen, items, trigger }: LiquidPopoverProps) => <>
    {trigger}
    {isOpen && <div role="menu" aria-label="Действия сообщения">
      {items?.map(item => <button key={item.id} type="button" role="menuitem" onClick={item.onSelect}>{item.label}</button>)}
    </div>}
  </>,
}));
vi.mock('./DiscussionVideoSaveDialog', () => ({
  DiscussionAttachmentSaveDialog: ({ target, onClose }: { target: DiscussionAttachmentSaveTarget; onClose: () => void }) =>
    <div role="dialog" aria-label="Сохранение вложения" data-target={JSON.stringify(target)}>
      <button type="button" onClick={onClose}>Закрыть сохранение</button>
    </div>,
}));
vi.mock('../media/discussionMediaCache', async importOriginal => ({
  ...await importOriginal<typeof import('../media/discussionMediaCache')>(),
  readDiscussionMedia: vi.fn(async () => null),
  downloadDiscussionMedia: vi.fn(async () => null),
}));

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it('offers Save for all received attachment kinds, passing authorized identity to the existing media reader', async () => {
  const cases = [
    { kind: 'photo' as const, mime: 'image/jpeg', duration: null },
    { kind: 'video' as const, mime: 'video/mp4', duration: 8 },
    { kind: 'video-note' as const, mime: 'video/mp4', duration: 5 },
    { kind: 'voice' as const, mime: 'audio/ogg', duration: 3 },
  ];
  const rows = cases.map(({ kind, mime, duration }, index) => ({
    ...message('incoming-' + kind, '', 'tg:2', index + 1),
    attachments: [{
      id: 'attachment-' + kind, messageId: 'incoming-' + kind, realmId: thread.realmId,
      owner: 'tg:2', authorUserId: 'tg:2', mediaType: kind, mimeType: mime, sizeBytes: 5,
      durationSeconds: duration, storageKey: 'mvp-media/' + String(index + 1).repeat(64),
      uploadState: 'ready' as const, confirmedAt: thread.createdAt,
    }],
  }));
  const { port } = fixture(rows);
  const view = render(<KonstaProvider theme="ios" dark><DiscussionSheet opened repository={port}
    threadId={thread.id} anchor={anchor} resolveAuthor={id => ({ name: id })}
    onClose={() => {}} parentNavigation={null} onNavigationContextChange={() => {}} />
  </KonstaProvider>);

  for (const { kind, mime } of cases) {
    const row = await waitFor(() => {
      const found = view.container.querySelector<HTMLElement>(`[data-message-id="incoming-${kind}"]`);
      if (!found) throw new Error('Missing received message ' + kind);
      return found;
    });
    fireEvent.click(within(row).getByRole('button', { name: 'Действия сообщения' }));
    const menu = await screen.findByRole('menu', { name: 'Действия сообщения' });
    expect(within(menu).getAllByRole('menuitem').map(item => item.textContent)).toEqual(['Ответить', 'Сохранить']);
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Сохранить' }));

    const dialog = screen.getByRole('dialog', { name: 'Сохранение вложения' });
    const target = JSON.parse(dialog.getAttribute('data-target') ?? '{}') as DiscussionAttachmentSaveTarget;
    expect(target).toEqual({
      mediaType: kind,
      url: expect.stringContaining('mvp-media/'),
      cache: {
        accountId: 'tg:1',
        storageKey: expect.stringMatching(/^mvp-media\//),
        mimeType: mime, sizeBytes: 5, realmId: thread.realmId,
        messageId: 'incoming-' + kind, attachmentId: 'attachment-' + kind,
      },
    });
    expect(within(menu).queryByRole('menuitem', { name: 'Удалить' })).toBeNull();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Закрыть сохранение' }));
  }
});

it('keeps Delete restricted to the author while making Save available to both participants', async () => {
  const published = { ...message('own-photo', '', 'tg:1'), attachments: [{
    id: 'own-attachment', messageId: 'own-photo', realmId: thread.realmId, owner: 'tg:1',
    authorUserId: 'tg:1', mediaType: 'photo' as const, mimeType: 'image/jpeg', sizeBytes: 5,
    durationSeconds: null, storageKey: 'mvp-media/' + 'a'.repeat(64),
    uploadState: 'ready' as const, confirmedAt: thread.createdAt,
  }] };
  const { port } = fixture([published]);
  const view = render(<KonstaProvider theme="ios" dark><DiscussionSheet opened repository={port}
    threadId={thread.id} anchor={anchor} resolveAuthor={id => ({ name: id })}
    onClose={() => {}} parentNavigation={null} onNavigationContextChange={() => {}} />
  </KonstaProvider>);
  const row = await waitFor(() => {
    const found = view.container.querySelector<HTMLElement>('[data-message-id="own-photo"]');
    if (!found) throw new Error('Missing own photo');
    return found;
  });
  fireEvent.click(within(row).getByRole('button', { name: 'Действия сообщения' }));
  const menu = await screen.findByRole('menu', { name: 'Действия сообщения' });
  expect(within(menu).getAllByRole('menuitem').map(item => item.textContent)).toEqual(['Ответить', 'Сохранить', 'Удалить']);
});
