// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { MezfitBottomSheet } from './BottomSheet';

afterEach(cleanup);

describe('MezfitBottomSheet', () => {
  it('uses Konsta Sheet as an opaque modal surface with a scroll-owned content area', () => {
    render(
      <MezfitBottomSheet opened label="Событие">
        <div>Контент</div>
      </MezfitBottomSheet>,
    );

    const dialog = screen.getByRole('dialog', { name: 'Событие' });
    expect(dialog.classList.contains('ui-mezfit-bottom-sheet')).toBe(true);
    expect(screen.getByText('Контент').closest('.ui-mezfit-bottom-sheet__content')).not.toBeNull();
    expect(document.querySelector('.ui-mezfit-bottom-sheet__backdrop')).toBeNull();
  });

  it('removes closed content from interaction and accessibility', () => {
    render(<MezfitBottomSheet opened={false} label="Событие" />);

    const dialog = document.querySelector<HTMLElement>('.ui-mezfit-bottom-sheet');
    expect(dialog?.getAttribute('aria-hidden')).toBe('true');
    expect(dialog?.hasAttribute('inert')).toBe(true);
    expect(document.querySelector('.ui-mezfit-bottom-sheet__backdrop')).toBeNull();
  });
});
