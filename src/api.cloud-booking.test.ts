import { afterEach, describe, expect, it, vi } from 'vitest';
import { confirmCloudWorkoutOccurrence } from './api';
import type { LocalWorkoutOccurrenceDraft } from './data/cloud/workout-occurrence-plan';
const plan = { name: 'Принятый локальный план', comment: null, exercises: [] };
const draft: LocalWorkoutOccurrenceDraft = {
  id: 'draft:stable-command', actorUserId: 'tg:101', realmId: 'tg:101', trainingPlanId: 'local-plan',
  programDayId: 'local-day', athleteUserId: 'tg:101', coachUserId: null, clientUserId: null,
  format: 'independent', startsAtUtc: '2026-10-19T08:00:00.000Z', durationMinutes: 60,
  plan, originalPlan: plan, createdAt: '2026-10-19T07:00:00.000Z', updatedAt: '2026-10-19T07:00:00.000Z',
};
afterEach(() => vi.unstubAllGlobals());
describe('cloud booking protocol', () => {
  it('sends structural access separately from the unchanged local PLAN', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => Response.json({ occurrenceId: 'confirmed', confirmed: true }));
    vi.stubGlobal('fetch', fetchMock);
    expect(await confirmCloudWorkoutOccurrence('signed-init-data', draft)).toBe('confirmed');
    const [path, init] = fetchMock.mock.calls[0];
    expect(path).toBe('/api/cloud/schedule/confirm');
    expect(new Headers(init?.headers).get('x-telegram-init-data')).toBe('signed-init-data');
    expect(JSON.parse(String(init?.body))).toMatchObject({
      trainingPlanId: 'local-plan', programDayId: 'local-day', plan,
      access: { realmId: 'tg:101', athleteUserId: 'tg:101', coachUserId: null, clientUserId: null },
    });
  });
  it('requires a confirmation receipt instead of inferring success from a lifecycle status', async () => {
    vi.stubGlobal('fetch', vi.fn<typeof fetch>(async () => Response.json({ occurrenceId: 'some-id', status: 'scheduled' })));
    await expect(confirmCloudWorkoutOccurrence('signed-init-data', draft))
      .rejects.toMatchObject({ status: 502, code: 'INVALID_API_RESPONSE' });
  });
});
