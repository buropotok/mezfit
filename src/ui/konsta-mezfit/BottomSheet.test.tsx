// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MezfitBottomSheet } from './BottomSheet';

afterEach(cleanup);

describe('MezfitBottomSheet', () => {
  it('uses Konsta Sheet as a modal surface with a scroll-owned content area', () => {
    render(
      <MezfitBottomSheet opened label="+ Событие" onClose={vi.fn()}>
        <div>Контент</div>
      </MezfitBottomSheet>,
    );

    const dialog = screen.getByRole('dialog', { name: '+ Событие' });
    expect(dialog.classList.contains('ui-mezfit-bottom-sheet')).toBe(true);
    expect(screen.getByText('Контент').closest('.ui-mezfit-bottom-sheet__content')).not.toBeNull();
    expect(document.querySelector('.ui-mezfit-bottom-sheet__backdrop')?.getAttribute('data-state')).toBe('opened');
  });

  it('closes from the backdrop by default', () => {
    const onClose = vi.fn();
    render(<MezfitBottomSheet opened label="+ Событие" onClose={onClose} />);

    fireEvent.click(document.querySelector('.ui-mezfit-bottom-sheet__backdrop') as HTMLElement);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('can keep the modal open when backdrop closing is disabled', () => {
    const onClose = vi.fn();
    render(
      <MezfitBottomSheet
        opened
        label="+ Тренировка"
        closeOnBackdrop={false}
        onClose={onClose}
      />,
    );

    fireEvent.click(document.querySelector('.ui-mezfit-bottom-sheet__backdrop') as HTMLElement);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('removes closed content from interaction and accessibility', () => {
    render(<MezfitBottomSheet opened={false} label="+ Событие" onClose={vi.fn()} />);

    const dialog = document.querySelector<HTMLElement>('.ui-mezfit-bottom-sheet');
    expect(dialog?.getAttribute('aria-hidden')).toBe('true');
    expect(dialog?.hasAttribute('inert')).toBe(true);
    expect(document.querySelector('.ui-mezfit-bottom-sheet__backdrop')?.getAttribute('data-state')).toBe('closed');
  });
});
