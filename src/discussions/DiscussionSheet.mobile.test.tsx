// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { KonstaProvider } from 'konsta/react';
import { DiscussionSheet } from './DiscussionSheet';
import { createDiscussionPreviewPort, previewDiscussionAnchor, previewDiscussionThread } from '../ui/discussion-preview';
import type { LiquidPopoverProps } from '../ui/LiquidPopover';

// This test covers the real Konsta message renderer; the animation is independent.
vi.mock('../ui/LiquidPopover', () => ({
  LiquidPopover: ({ trigger }: LiquidPopoverProps) => <>{trigger}</>,
}));
afterEach(cleanup);

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
    const view = render(<KonstaProvider theme="ios" dark><DiscussionSheet {...options} /></KonstaProvider>);
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
    expect(screen.getByRole('button', { name: 'Добавить вложение (пока недоступно)' })).toHaveProperty('disabled', true);
    expect(screen.getByRole('button', { name: 'Отправить' })).toBeTruthy();
    const composer = view.container.querySelector('.discussion-composer');
    expect(composer).not.toBeNull();
    expect(composer?.classList.contains('ui-glass-surface')).toBe(false);
    expect(composer?.querySelectorAll(':scope > .ui-glass-surface')).toHaveLength(3);
    expect(composer?.querySelector('.discussion-composer__field.ui-glass-surface .ui-mezfit-messagebar--bare')).not.toBeNull();
    expect(composer?.querySelectorAll(':scope > .discussion-composer__button.ui-glass-surface')).toHaveLength(2);
    expect(composer?.querySelectorAll('.discussion-composer__button > .ui-icon-button')).toHaveLength(2);
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
