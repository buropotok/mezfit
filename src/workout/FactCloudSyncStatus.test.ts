import { describe, expect, it } from 'vitest';
import type { CloudSyncStatus } from '../data/cloud/CloudConnectionsProvider';
import { factCloudSyncPresentation } from './FactCloudSyncStatus';

describe('FACT global cloud synchronization indicator', () => {
  it.each([
    ['pending', 'В ожидании', 'yellow'],
    ['synced', 'Синхронизировано', 'green'],
    ['offline', 'Нет соединения', 'gray'],
    ['error', 'Ошибка', 'red'],
  ] as const)('shows %s with a truthful sync state rather than a per-session receipt',
    (status: CloudSyncStatus, label, color) => {
      const view = factCloudSyncPresentation(status);
      expect(view.label).toBe(label);
      expect(view.color).toBe(color);
      expect(view.explanation).toContain('общее состояние Dexie Cloud');
      expect(view.explanation).toContain('не отдельное подтверждение');
    });
});
