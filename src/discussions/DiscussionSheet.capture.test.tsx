// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { KonstaProvider } from 'konsta/react';
import type { ComponentProps } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { DiscussionSheet, type DiscussionSheetProps } from './DiscussionSheet';
import type { DiscussionVideoRecorder } from './DiscussionVideoRecorder';
import { anchor, fixture, thread } from './discussion-fixture.test-support';
import { inspectDiscussionMedia } from './discussion-media-file';

vi.mock('./discussion-media-file', () => ({ inspectDiscussionMedia: vi.fn() }));
vi.mock('./DiscussionVideoRecorder', () => ({
  DiscussionVideoRecorder: ({ onCancel, onUse }: ComponentProps<typeof DiscussionVideoRecorder>) =>
    <section aria-label="Запись видео">
      <button onClick={onCancel}>Отменить</button>
      <button onClick={() => onUse(new File(['video'], 'Видео.mp4', { type: 'video/mp4' }))}>Использовать видео</button>
    </section>,
}));

beforeEach(() => {
  vi.stubGlobal('matchMedia', () => ({ matches: true }));
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
  vi.stubGlobal('URL', class extends URL {
    static createObjectURL = vi.fn(() => 'blob:recording-preview');
    static revokeObjectURL = vi.fn();
  });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.clearAllMocks(); });

async function openAttachmentMenu() {
  const port = { ...fixture().port, supportsMedia: true };
  const navigation = vi.fn<DiscussionSheetProps['onNavigationContextChange']>();
  const view = render(<KonstaProvider theme="ios" dark><DiscussionSheet opened repository={port}
    threadId={thread.id} anchor={anchor} resolveAuthor={id => ({ name: id })} onClose={() => {}}
    parentNavigation={null} onNavigationContextChange={navigation} /></KonstaProvider>);
  const trigger = await screen.findByRole('button', { name: 'Добавить вложение' });
  await waitFor(() => expect(trigger).toHaveProperty('disabled', false));
  fireEvent.click(trigger);
  const photo = await screen.findByRole('menuitem', { name: 'Фото' });
  return { ...view, photo, navigation, port };
}

it('opens a LiquidPopover with two items and uses the image-only chooser for Фото', async () => {
  const click = vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => {});
  const { photo } = await openAttachmentMenu();
  const menu = screen.getByRole('menu', { name: 'Вложения' });
  expect(within(menu).getAllByRole('menuitem').map(item => item.textContent)).toEqual(['Фото', 'Видео']);
  fireEvent.click(photo);
  expect(click).toHaveBeenCalledOnce();
  const picker = click.mock.instances[0];
  if (!(picker instanceof HTMLInputElement)) throw new Error('Expected a file input');
  expect(picker.accept).toContain('image/jpeg');
  expect(picker.accept).not.toContain('video/');
});

it('uses Telegram Back to cancel capture without inspecting, uploading or sending a file', async () => {
  const { navigation, port } = await openAttachmentMenu();
  fireEvent.click(screen.getByRole('menuitem', { name: 'Видео' }));
  expect(screen.getByRole('region', { name: 'Запись видео' })).toBeTruthy();
  act(() => navigation.mock.lastCall?.[0]?.onBack?.());
  expect(screen.queryByRole('region', { name: 'Запись видео' })).toBeNull();
  expect(inspectDiscussionMedia).not.toHaveBeenCalled();
  expect(port.send).not.toHaveBeenCalled();
});

it('passes a confirmed take through ordinary video attachment preparation without auto-send', async () => {
  vi.mocked(inspectDiscussionMedia).mockImplementation(async file => ({
    file,
    metadata: {
      id: 'recorded-video', storageKey: 'mvp-media/' + 'b'.repeat(64),
      mediaType: 'video', mimeType: file.type, sizeBytes: file.size,
      fileName: file.name, durationSeconds: 2, uploadState: 'uploading',
    },
  }));
  const { port } = await openAttachmentMenu();
  fireEvent.click(screen.getByRole('menuitem', { name: 'Видео' }));
  fireEvent.click(screen.getByRole('button', { name: 'Использовать видео' }));
  await screen.findByRole('region', { name: 'Предпросмотр вложения' });
  expect(inspectDiscussionMedia).toHaveBeenCalledWith(
    expect.objectContaining({ name: 'Видео.mp4', type: 'video/mp4', size: 5 }), expect.any(AbortSignal),
  );
  expect(screen.getByRole('button', { name: 'Отправить' })).toBeTruthy();
  expect(port.send).not.toHaveBeenCalled();
});
