// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getMe } from '../api';
import { createCloudDatabase, type MezfitCloudDatabase } from '../data/cloud/database';
import { FlexAttributesRepository } from '../data/cloud/flex-attributes';
import { CloudAuthDiagnostic } from './CloudAuthDiagnostic';
import { FLEX_PROBE_KEY, FlexAttributesDiagnostic } from './FlexAttributesDiagnostic';

const probe = vi.hoisted(() => ({
  setValue: vi.fn(),
  getValues: vi.fn(),
}));
vi.mock('../api', async (importOriginal) => ({
  ...await importOriginal<typeof import('../api')>(),
  getMe: vi.fn(),
}));
vi.mock('../data/cloud/database', () => ({ createCloudDatabase: vi.fn() }));
vi.mock('../data/cloud/flex-attributes', () => ({
  FlexAttributesRepository: vi.fn().mockImplementation(() => probe),
}));

const open = vi.fn(async () => undefined);
const close = vi.fn();
const sync = vi.fn(async (_request: { purpose: 'pull' | 'push'; wait: boolean }) => undefined);
const unsubscribe = vi.fn();
const subscribe = vi.fn((listener: { next(user: { userId: string }): void }) => {
  listener.next({ userId: 'tg:42' });
  return { unsubscribe };
});
const database = { open, close, cloud: { currentUser: { subscribe }, sync } } as unknown as MezfitCloudDatabase;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getMe).mockResolvedValue({ user: { telegramUserId: '42' } } as Awaited<ReturnType<typeof getMe>>);
  vi.mocked(createCloudDatabase).mockReturnValue(database);
  probe.setValue.mockResolvedValue(undefined);
  probe.getValues.mockResolvedValue([]);
});

afterEach(() => {
  cleanup();
  delete window.Telegram;
});

describe('real-account Flex Attributes diagnostic', () => {
  it('requires an explicit button and uses only the Worker-verified personal realm', async () => {
    probe.getValues.mockImplementation(async () => [
      { key: FLEX_PROBE_KEY, valueType: 'string', value: probe.setValue.mock.calls[0]?.[1]?.value },
    ]);
    const view = render(<FlexAttributesDiagnostic initData="private-init-data" />);
    await waitFor(() => expect((screen.getByRole('button', { name: 'Записать тестовое значение' }) as HTMLButtonElement).disabled).toBe(false));
    expect(probe.setValue).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Записать тестовое значение' }));
    await waitFor(() => expect(screen.getByText(/отправка через Addon завершилась/)).toBeTruthy());
    expect(getMe).toHaveBeenCalledWith('private-init-data');
    expect(createCloudDatabase).toHaveBeenCalledWith('42', 'private-init-data');
    expect(FlexAttributesRepository).toHaveBeenCalledWith(database, 'tg:42');
    expect(probe.setValue).toHaveBeenCalledWith(
        { entityType: 'user', realmId: 'tg:42', entityId: 'tg:42' },
        { key: FLEX_PROBE_KEY, valueType: 'string', value: expect.any(String) },
      );
    expect(sync).toHaveBeenCalledWith({ purpose: 'push', wait: true });
    expect(document.body.textContent).not.toContain('private-init-data');
    expect(document.body.textContent).not.toContain('tg:42');
    view.unmount();
    expect(unsubscribe).toHaveBeenCalled();
    expect(close).toHaveBeenCalledWith({ disableAutoOpen: false });
  });

  it('pulls before reading and displays only the saved diagnostic marker', async () => {
    const marker = '2026-10-30T12:00:00.000Z';
    probe.getValues.mockResolvedValue([{ key: FLEX_PROBE_KEY, valueType: 'string', value: marker }]);
    render(<FlexAttributesDiagnostic initData="signed" />);
    await waitFor(() => expect((screen.getByRole('button', { name: 'Загрузить из облака и прочитать' }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByRole('button', { name: 'Загрузить из облака и прочитать' }));
    await waitFor(() => expect(screen.getByText('Контрольное значение: ' + marker)).toBeTruthy());
    expect(sync).toHaveBeenCalledWith({ purpose: 'pull', wait: true });
    expect(probe.getValues).toHaveBeenCalledWith({ entityType: 'user', realmId: 'tg:42', entityId: 'tg:42' });
    expect(probe.setValue).not.toHaveBeenCalled();
  });

  it('does not write when the Dexie Cloud identity differs from the verified Worker identity', async () => {
    subscribe.mockImplementationOnce((listener: { next(user: { userId: string }): void }) => {
      listener.next({ userId: 'tg:other' });
      return { unsubscribe };
    });
    render(<FlexAttributesDiagnostic initData="signed" />);
    await waitFor(() => expect(open).toHaveBeenCalledOnce());
    const button = screen.getByRole('button', { name: 'Записать тестовое значение' }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(probe.setValue).not.toHaveBeenCalled();
  });

  it('does not leak an upstream error body or claim that an unsuccessful push was persisted', async () => {
    probe.getValues.mockImplementation(async () => [
      { key: FLEX_PROBE_KEY, valueType: 'string', value: probe.setValue.mock.calls[0]?.[1]?.value },
    ]);
    sync.mockRejectedValueOnce(new Error('secret Cloud token'));
    render(<FlexAttributesDiagnostic initData="signed" />);
    await waitFor(() => expect((screen.getByRole('button', { name: 'Записать тестовое значение' }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByRole('button', { name: 'Записать тестовое значение' }));
    await waitFor(() => expect(screen.getByText(/Проверка не удалась/)).toBeTruthy());
    expect(sync).toHaveBeenCalledWith({ purpose: 'push', wait: true });
    expect(document.body.textContent).not.toContain('secret Cloud token');
    expect(document.body.textContent).not.toContain('отправка через Addon завершилась');
  });

  it('opens and closes the isolated Flex surface only on an explicit diagnostic action', async () => {
    window.Telegram = { WebApp: {
      initData: 'signed', colorScheme: 'dark', ready: vi.fn(), expand: vi.fn(),
    } };
    render(<CloudAuthDiagnostic />);
    expect(createCloudDatabase).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Проверить Flex Attributes' }));
    await waitFor(() => expect(screen.getByRole('heading', { name: /Flex Attributes/ })).toBeTruthy());
    expect(createCloudDatabase).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button', { name: 'Скрыть проверку Flex Attributes' }));
    expect(close).toHaveBeenCalled();
  });
});
