import { describe, expect, it, vi } from 'vitest';
import { stableCloudRelationshipId } from '../../shared/relationship-id';
import { readNotificationClientName } from './workout-reminders';

describe('Telegram client topic name', () => {
  const realmId = 'rlm-test';
  const clientId = 'tg:123';

  it('uses the current contact profile name before the membership fallback', async () => {
    const id = await stableCloudRelationshipId('prf', realmId + ':' + clientId);
    const fetchCloud = vi.fn<typeof fetch>(async () => Response.json({
      id, realmId, userId: clientId, owner: null, name: '  Анна Иванова  ',
    }));

    await expect(readNotificationClientName(realmId, clientId, 'Клиент', 'token', fetchCloud))
      .resolves.toBe('Анна Иванова');
    expect(String(fetchCloud.mock.calls[0][0])).toContain('/all/contactProfiles/' + id);
  });

  it('uses the membership name if the contact profile belongs to another realm', async () => {
    const id = await stableCloudRelationshipId('prf', realmId + ':' + clientId);
    const fetchCloud = vi.fn<typeof fetch>(async () => Response.json({
      id, realmId: 'rlm-other', userId: clientId, owner: null, name: 'Чужой профиль',
    }));

    await expect(readNotificationClientName(realmId, clientId, 'Анна', 'token', fetchCloud))
      .resolves.toBe('Анна');
  });
});
