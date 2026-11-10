// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { KonstaProvider } from 'konsta/react';
import { DiscussionSheet } from './DiscussionSheet';
import { createDiscussionPreviewPort, previewDiscussionAnchor, previewDiscussionThread } from '../ui/discussion-preview';
import type { LiquidPopoverProps } from '../ui/LiquidPopover';
import { prepareDiscussionMessage } from '../data/cloud/discussions';
import type { DiscussionMediaDraft } from '../data/cloud/discussion-media';
import { anchor, fixture, thread } from './discussion-fixture.test-support';

// This test covers the real Konsta message renderer; the animation is independent.
vi.mock('../ui/LiquidPopover', () => ({
  LiquidPopover: ({ trigger }: LiquidPopoverProps) => <>{trigger}</>,
}));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('COMM-05 mobile presentation', () => {
  const authors = (id: string) => ({ name: id === 'tg:101' ? 'Тренер' : 'Спортсмен' });
  const props = () => ({
    opened: true,
    repository: createDiscussionPreviewPort(),
    threadId: previewDiscussionThread.id,
    anchor: previewDiscussionAnchor,
    onClose: vi.fn(),
    resolveAuthor: authors,
    parentNavigation: null,
    onNavigationContextChange: vi.fn(),
  });

  it('renders a compact thread without author rows, with real bubble metadata and synthetic demo receipts', async () => {
    const options = props();
    const view = render(<KonstaProvider theme="ios" dark><DiscussionSheet {...options}
      glassSettings={{ preset: 'frosted', optics: false, blur: 13 }} /></KonstaProvider>);
    await screen.findByText('Доброе утро! Как прошла тренировка по новой программе?');
    expect(view.container.querySelector('.ui-avatar')).toBeNull();
    expect(screen.getByText('Демо').closest('.discussion-thread__header')).not.toBeNull();
    expect(view.container.querySelector('.discussion-composer-context')?.textContent).not.toContain('Демо');
    expect(screen.getAllByRole('img', { name: 'Прочитано собеседником' }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('img', { name: 'Отправка подтверждена Dexie Cloud' }).length).toBeGreaterThan(0);
    const row = view.container.querySelector('[data-message-id="preview-3"]');
    expect(row?.querySelector('.ui-mezfit-message__inline-meta')?.textContent).toMatch(/\d\d:\d\d/);
    expect(row?.querySelector('.ui-mezfit-message__meta-reserve')).not.toBeNull();
    expect(row?.querySelector('.discussion-quote')).not.toBeNull();
    expect(row?.querySelector('.ui-mezfit-message__inline-meta svg')).toBeNull(); // Icons come from the shared SVG registry masks.
    expect(row?.querySelector('.discussion-message-text.ui-text--chat')).not.toBeNull();
    expect(row?.querySelector('.discussion-message-meta .ui-text--caption')).not.toBeNull();
    expect(row?.querySelector('.discussion-quote .ui-text--footnote')).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Добавить вложение (пока недоступно)' })).toHaveProperty('disabled', true);
    expect(screen.getByRole('button', { name: 'Переключить на кружок' })).toBeTruthy();
    const composer = view.container.querySelector('.discussion-composer');
    expect(composer).not.toBeNull();
    expect(composer?.classList.contains('ui-glass-surface')).toBe(false);
    const glass = composer?.querySelectorAll(':scope > .ui-glass-surface');
    expect(glass).toHaveLength(3);
    expect(Array.from(glass ?? [], element =>
      (element as HTMLElement).style.getPropertyValue('--ui-glass-surface-blur'))).toEqual(['13px', '13px', '13px']);
    expect(composer?.querySelector('.discussion-composer__field.ui-glass-surface .ui-mezfit-messagebar--bare')).not.toBeNull();
    expect(composer?.querySelectorAll(':scope > .discussion-composer__button.ui-glass-surface')).toHaveLength(2);
    expect(composer?.querySelectorAll('.discussion-composer__button > .ui-icon-button')).toHaveLength(2);
  });

  it('morphs microphone, camera and send while preserving the last media mode', async () => {
    const options = props();
    const view = render(<KonstaProvider theme="ios" dark><DiscussionSheet {...options} /></KonstaProvider>);
    await screen.findByText('Доброе утро! Как прошла тренировка по новой программе?');
    const microphone = screen.getByRole('button', { name: 'Переключить на кружок' });
    expect(microphone.querySelector('svg')?.getAttribute('viewBox')).toBe('0 0 24 24');
    expect(microphone.querySelectorAll('svg path')).toHaveLength(1);
    await waitFor(() => expect((microphone as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(microphone);
    expect(screen.getByRole('button', { name: 'Переключить на голосовое' })).toBeTruthy();
    const input = screen.getByPlaceholderText('Сообщение');
    fireEvent.change(input, { target: { value: 'Текст' } });
    expect(screen.getByRole('button', { name: 'Отправить' })).toBeTruthy();
    fireEvent.change(input, { target: { value: '' } });
    expect(screen.getByRole('button', { name: 'Переключить на голосовое' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Переключить на голосовое' }));
    expect(screen.getByRole('button', { name: 'Переключить на кружок' })).toBeTruthy();
    expect(view.container.querySelectorAll('.discussion-composer__button > .ui-icon-button')).toHaveLength(2);
  });

  it('uses the same sheet for author mode and preserves multiline drafts', async () => {
    const options = props();
    const view = render(<KonstaProvider theme="ios" dark><DiscussionSheet {...options} showAvatars /></KonstaProvider>);
    await screen.findByText('Доброе утро! Как прошла тренировка по новой программе?');
    expect(view.container.querySelectorAll('.ui-avatar').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Тренер').length).toBeGreaterThan(0);
    const input = screen.getByPlaceholderText('Сообщение');
    fireEvent.change(input, { target: { value: 'Тест многострочного ввода\nВторая строка' } });
    await waitFor(() => expect((input as HTMLTextAreaElement).value).toContain('Вторая строка'));
  });
});


it('clears a voice draft at the start of trash animation, keeping the full-size red icon until removal completes', async () => {
  // A reduced-motion device completes the visual effect immediately; persistence
  // must still begin at the click and keep the composer from showing stale audio.
  vi.stubGlobal('matchMedia', () => ({ matches: true }));
  const voice: DiscussionMediaDraft = {
    id: 'voice-preview', storageKey: 'mvp-media/' + 'c'.repeat(64), mediaType: 'voice',
    mimeType: 'audio/mp4', sizeBytes: 16, durationSeconds: 4, waveform: [0.2, 0.8],
    fileName: 'voice.m4a', uploadState: 'failed',
  };
  const draft = { ...prepareDiscussionMessage(thread.id, ''), draftMedia: voice };
  let finishRemoval: (() => void) | undefined;
  const updateDraftMedia = vi.fn(() => new Promise<void>(resolve => { finishRemoval = resolve; }));
  const port = { ...fixture().port, supportsMedia: true, getDraft: vi.fn(async () => draft), updateDraftMedia };
  const view = render(<KonstaProvider theme="ios" dark><DiscussionSheet opened repository={port}
    threadId={thread.id} anchor={anchor} resolveAuthor={id => ({ name: id })}
    onClose={() => {}} parentNavigation={null} onNavigationContextChange={() => {}} /></KonstaProvider>);
  const trash = await screen.findByRole('button', { name: 'Удалить голосовое сообщение' });
  expect(trash.classList.contains('ui-icon-button--color-red')).toBe(true);
  const svg = trash.querySelector('svg');
  const viewport = svg?.getAttribute('viewBox')?.split(' ').map(Number);
  expect(svg?.getAttribute('width')).toBe('24');
  expect(viewport?.[2]).toBeLessThanOrEqual(420);
  expect(viewport?.[3]).toBeLessThanOrEqual(420);
  expect(view.container.querySelector('.discussion-composer__voice-placeholder')).not.toBeNull();
  await waitFor(() => expect(trash).toHaveProperty('disabled', false));

  fireEvent.click(trash);
  expect(updateDraftMedia).toHaveBeenCalledWith(thread.id, draft.id, voice.storageKey, 'clear');
  expect(view.container.querySelector('.discussion-composer__voice-placeholder')).toBeNull();
  expect(screen.getByPlaceholderText('Сообщение')).toHaveProperty('disabled', true);
  expect(screen.getByRole('button', { name: 'Удалить голосовое сообщение' })).toHaveProperty('disabled', true);

  await act(async () => { finishRemoval?.(); });
  expect(screen.getByRole('button', { name: 'Добавить вложение' })).toBeTruthy();
  expect(screen.getByPlaceholderText('Сообщение')).toHaveProperty('disabled', false);
});
