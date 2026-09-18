// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BottomSheet } from './index';

afterEach(cleanup);

describe('BottomSheet', () => {
  it('uses the modal color contract by default and exposes an accessible dialog title', () => {
    render(
      <BottomSheet isOpen title="Упражнения" onClose={vi.fn()}>
        <div>Контент</div>
      </BottomSheet>,
    );

    const dialog = screen.getByRole('dialog', { name: 'Упражнения' });
    expect(dialog.closest('.ui-bottom-sheet')?.className).toContain('ui-bottom-sheet--modal-color');
    expect(screen.getByText('Контент')).toBeTruthy();
  });

  it('can opt into the ordinary surface color through modalColor=false', () => {
    render(
      <BottomSheet isOpen title="Упражнения" modalColor={false} onClose={vi.fn()}>
        <div>Контент</div>
      </BottomSheet>,
    );

    const dialog = screen.getByRole('dialog', { name: 'Упражнения' });
    expect(dialog.closest('.ui-bottom-sheet')?.className).not.toContain('ui-bottom-sheet--modal-color');
  });

  it('renders a caller-owned leading header action without changing dialog semantics', () => {
    render(
      <BottomSheet
        isOpen
        title="Грудь"
        headerLeading={<button type="button" aria-label="Назад">←</button>}
        onClose={vi.fn()}
      >
        <div>Контент</div>
      </BottomSheet>,
    );

    expect(screen.getByRole('dialog', { name: 'Грудь' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Назад' })).toBeTruthy();
  });

  it('renders a floating action outside the scroll content', () => {
    render(
      <BottomSheet
        isOpen
        title="Упражнения"
        floatingAction={<button type="button">ОК</button>}
        onClose={vi.fn()}
      >
        <div>Контент</div>
      </BottomSheet>,
    );

    const action = screen.getByRole('button', { name: 'ОК' });
    expect(action.closest('.ui-bottom-sheet__floating-action')).toBeTruthy();
    expect(action.closest('.ui-bottom-sheet__content')).toBeNull();
  });
  it('closes through its public close control', () => {
    const onClose = vi.fn();

    render(
      <BottomSheet isOpen title="Упражнения" onClose={onClose}>
        <div>Контент</div>
      </BottomSheet>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Закрыть' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
