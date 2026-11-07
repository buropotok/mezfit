// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { KonstaProvider } from 'konsta/react';
import { DiscussionSheet, type DiscussionSheetProps } from './DiscussionSheet';
import { anchor, fixture } from './discussion-fixture.test-support';

afterEach(cleanup);
it('keeps the same historical chat and shows source unavailability outside the clipped title', async () => {
  const { port } = fixture();
  const props: DiscussionSheetProps = { opened: true, repository: port, threadId: 'thread', anchor,
    contextLabel: 'Жим · Подход 1', onClose: vi.fn(), onNavigationContextChange: vi.fn(),
    parentNavigation: null, resolveAuthor: () => ({ name: 'Участник' }) };
  const sheet = (unavailable: boolean) => <KonstaProvider theme="ios" dark>
    <DiscussionSheet {...props} contextUnavailable={unavailable} />
  </KonstaProvider>;
  const view = render(sheet(false));
  await screen.findByText('Мой текст');
  view.rerender(sheet(true));
  const notice = screen.getByText('Объект недоступен. История обсуждения сохранена.');
  expect(notice.getAttribute('role')).toBe('status');
  expect(notice.closest('.discussion-thread__title')).toBeNull();
  expect(screen.getByText('Мой текст')).toBeTruthy();
  expect(port.listThreads).toHaveBeenCalledOnce();
  expect(screen.getByText('Жим · Подход 1')).toBeTruthy();
});
