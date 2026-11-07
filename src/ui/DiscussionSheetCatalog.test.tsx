// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DiscussionSheetProps } from '../discussions/DiscussionSheet';
import { DiscussionSheetCatalog } from './DiscussionSheetCatalog';

vi.mock('../discussions', () => ({
  DiscussionSheet: ({ opened, onClose, focusMessageId }: DiscussionSheetProps) => <div
    data-testid="preview-sheet" data-opened={String(opened)} data-focus={focusMessageId ?? ''}>
    <button onClick={onClose}>Закрыть демо переписки</button>
  </div>,
}));

afterEach(cleanup);

describe('DiscussionSheet catalogue entry', () => {
  it('opens the actual-sheet entry with normal and deep-link targets; reset is available only when closed', () => {
    render(<DiscussionSheetCatalog />);
    const sheet = screen.getByTestId('preview-sheet');
    const reset = screen.getByRole('button', { name: 'Сбросить демо' });
    expect(sheet.getAttribute('data-opened')).toBe('false');

    fireEvent.click(screen.getByRole('button', { name: 'Открыть переписку' }));
    expect(sheet.getAttribute('data-opened')).toBe('true');
    expect(sheet.getAttribute('data-focus')).toBe('');
    expect(reset).toHaveProperty('disabled', true);

    fireEvent.click(screen.getByRole('button', { name: 'Закрыть демо переписки' }));
    expect(sheet.getAttribute('data-opened')).toBe('false');
    expect(reset).toHaveProperty('disabled', false);

    fireEvent.click(screen.getByRole('button', { name: 'Открыть с фокусом на ответе' }));
    expect(sheet.getAttribute('data-opened')).toBe('true');
    expect(sheet.getAttribute('data-focus')).toBe('preview-2');
  });
});
