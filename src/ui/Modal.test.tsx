// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Modal } from './components';

describe('Modal alert variant', () => {
  it('renders Telegram-style actions without the generic close button by default', () => {
    const onClose = vi.fn();
    const onConfirm = vi.fn();
    render(
      <Modal
        isOpen
        variant="alert"
        title="Удалить тренировку?"
        onClose={onClose}
        actions={[{ id: 'delete', label: 'Удалить', tone: 'danger', onClick: onConfirm }]}
      >
        Действие нельзя отменить.
      </Modal>
    );

    expect(screen.getByText('Удалить тренировку?')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Закрыть' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Удалить' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('keeps the existing generic modal close behavior', () => {
    const onClose = vi.fn();
    render(<Modal isOpen title="Обычная модалка" onClose={onClose}>Контент</Modal>);

    fireEvent.click(screen.getByRole('button', { name: 'Закрыть' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('supports disabled alert actions', () => {
    render(
      <Modal
        isOpen
        variant="alert"
        title="Подтверждение"
        onClose={() => undefined}
        actions={[{ id: 'confirm', label: 'Продолжить', disabled: true, onClick: () => undefined }]}
      >
        Проверьте данные.
      </Modal>
    );

    expect((screen.getByRole('button', { name: 'Продолжить' }) as HTMLButtonElement).disabled).toBe(true);
  });
});
