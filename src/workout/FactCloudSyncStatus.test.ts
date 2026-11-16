// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import type { CloudSyncStatus } from '../data/cloud/CloudConnectionsProvider';
import { factCloudSyncPresentation } from './FactCloudSyncStatus';

describe('FACT global cloud synchronization indicator', () => {
  it.each([
    ['local', 'Локально', 'gray', 'Изменения хранятся на устройстве. Облачная синхронизация ещё не подтверждена.'],
    ['syncing', 'Синхронизация', 'yellow', 'Идёт отправка или получение изменений из Mezfit облака.'],
    ['synced', 'Синхронизировано', 'green', 'Синхронизация с облаком Mezfit завершена.'],
    ['error', 'Ошибка', 'red', 'Не удалось синхронизировать данные с облаком Mezfit. Изменения сохранены на устройстве.'],
  ] as const)('shows %s with clear, user-facing Mezfit cloud wording',
    (status: CloudSyncStatus, label, color, explanation) => {
      const view = factCloudSyncPresentation(status);
      expect(view.label).toBe(label);
      expect(view.color).toBe(color);
      expect(view.explanation).toBe(explanation);
      expect(view.explanation).not.toMatch(/Dexie|очередь синхронизации|этой тренировки/);
    });
});
