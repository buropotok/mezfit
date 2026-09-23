// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Modal } from './components';

afterEach(() => cleanup());

describe('Modal alert variant', () => {
  it('renders alert semantics and Telegram-style actions without the generic close button', () => {
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

    expect(screen.getByRole('alertdialog', { name: 'Удалить тренировку?' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Закрыть' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Удалить' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('does not dismiss an alert dialog with Escape', () => {
    const onClose = vi.fn();
    render(<Modal isOpen variant="alert" title="Подтверждение" onClose={onClose}>Проверьте данные.</Modal>);

    fireEvent.keyDown(screen.getByRole('alertdialog'), { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
  });

  it('keeps the existing generic modal close behavior', () => {
    const onClose = vi.fn();
    render(<Modal isOpen title="Обычная модалка" onClose={onClose}>Контент</Modal>);

    fireEvent.click(screen.getByRole('button', { name: 'Закрыть' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('renders an explicitly migrated compact modal with Konsta Dialog semantics', () => {
    const onClose = vi.fn();
    const onSave = vi.fn();
    render(
      <Modal
        isOpen
        presentation="dialog"
        title="Добавить фазу"
        onClose={onClose}
        actions={[
          { id: 'cancel', label: 'Отмена', onClick: onClose },
          { id: 'save', label: 'Добавить', tone: 'primary', onClick: onSave },
        ]}
      >
        Контент
      </Modal>
    );

    expect(screen.getByRole('dialog', { name: 'Добавить фазу' })).toBeTruthy();
    expect(document.querySelector('.ui-modal__dialog')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Добавить' }));
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it('keeps Konsta Dialog mounted while its opened state changes', () => {
    const onClose = vi.fn();
    const { rerender } = render(
      <Modal
        isOpen={false}
        presentation="dialog"
        title="Добавить фазу"
        onClose={onClose}
      >
        Контент
      </Modal>
    );

    const closedDialog = document.querySelector('[role="dialog"]');
    expect(closedDialog).not.toBeNull();

    rerender(
      <Modal
        isOpen
        presentation="dialog"
        title="Добавить фазу"
        onClose={onClose}
      >
        Контент
      </Modal>
    );

    expect(document.querySelector('[role="dialog"]')).toBe(closedDialog);
  });

  it('keeps a confirm dismissible when all supplied actions are disabled', () => {
    const onClose = vi.fn();
    render(
      <Modal
        isOpen
        variant="alert"
        title="Подтверждение"
        onClose={onClose}
        actions={[{ id: 'confirm', label: 'Продолжить', disabled: true, onClick: () => undefined }]}
      >
        Проверьте данные.
      </Modal>
    );

    expect((screen.getByRole('button', { name: 'Продолжить' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Закрыть' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
