// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import type { CloudSyncStatus } from '../data/cloud/CloudConnectionsProvider';
import { factCloudSyncPresentation } from './FactCloudSyncStatus';

describe('FACT global cloud synchronization indicator', () => {
  it.each([
    ['pending', 'В ожидании', 'yellow', 'Ожидается синхронизация с облаком Mezfit.'],
    ['synced', 'Синхронизировано', 'green', 'Синхронизация с облаком Mezfit завершена.'],
    ['offline', 'Нет соединения', 'gray',
      'Нет соединения с облаком Mezfit. Изменения сохраняются на устройстве и синхронизируются после подключения к интернету.'],
    ['error', 'Ошибка', 'red',
      'Не удалось синхронизировать данные с облаком Mezfit. Изменения сохранены на устройстве.'],
  ] as const)('shows %s with clear, user-facing Mezfit cloud wording',
    (status: CloudSyncStatus, label, color, explanation) => {
      const view = factCloudSyncPresentation(status);
      expect(view.label).toBe(label);
      expect(view.color).toBe(color);
      expect(view.explanation).toBe(explanation);
      expect(view.explanation).not.toMatch(/Dexie|очередь синхронизации|этой тренировки/);
    });
});
