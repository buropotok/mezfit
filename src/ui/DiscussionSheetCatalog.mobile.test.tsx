// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DiscussionSheetProps } from '../discussions/DiscussionSheet';
import { DiscussionSheetCatalog } from './DiscussionSheetCatalog';

vi.mock('../discussions', () => ({
  DiscussionSheet: ({ showAvatars }: DiscussionSheetProps) =>
    <div data-testid="catalog-sheet-mode" data-show-avatars={String(showAvatars)} />,
}));
afterEach(cleanup);

describe('COMM-05 catalogue controls', () => {
  it('switches presentation on the same DiscussionSheet without replacing its in-memory source', () => {
    render(<DiscussionSheetCatalog />);
    const sheet = screen.getByTestId('catalog-sheet-mode');
    expect(sheet.getAttribute('data-show-avatars')).toBe('false');
    fireEvent.click(screen.getByRole('button', { name: 'С аватарами · групповой' }));
    expect(sheet.getAttribute('data-show-avatars')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: 'Без аватаров · основной' }));
    expect(sheet.getAttribute('data-show-avatars')).toBe('false');
    expect(screen.getByText(/демонстрационные статусы/)).toBeTruthy();
  });
});
