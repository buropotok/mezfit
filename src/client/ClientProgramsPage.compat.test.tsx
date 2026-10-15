import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useAssignedPrograms } from '../data/cloud/AssignedProgramsProvider';
import { useClientCoach } from './ClientCoachContext';
import { ClientProgramsPage } from './ClientProgramsPage';

vi.mock('../data/cloud/program-management-activation', () => ({
  CLOUD_PROGRAM_MANAGEMENT_ENABLED: false,
}));
vi.mock('../data/cloud/pilot-activation', () => ({ CLOUD_ASSIGNED_PROGRAMS_ENABLED: true }));
vi.mock('../data/cloud/AssignedProgramsProvider', () => ({ useAssignedPrograms: vi.fn() }));
vi.mock('./ClientCoachContext', () => ({ useClientCoach: vi.fn() }));

beforeEach(() => {
  vi.mocked(useClientCoach).mockReturnValue({
    coaches: [{ relationshipId: 'rlm1', userId: 'tg:202', telegramUserId: '202', displayName: 'Тренер' }],
    selectedCoach: { relationshipId: 'rlm1', userId: 'tg:202', telegramUserId: '202', displayName: 'Тренер' },
    status: 'ready', error: '', selectCoach: vi.fn(), refreshCoaches: vi.fn(),
  });
  vi.mocked(useAssignedPrograms).mockReturnValue({
    actorUserId: 'tg:101',
    plans: [{
      id: 'tra1', realmId: 'rlm1', owner: null,
      coachUserId: 'tg:202', clientUserId: 'tg:101',
      name: 'Отменённая программа', position: 0, status: 'cancelled',
      startedAt: null, finishedAt: null, createdAt: '', updatedAt: '',
    }],
    status: 'ready', error: '',
    repository: {} as NonNullable<ReturnType<typeof useAssignedPrograms>>['repository'],
    refresh: vi.fn(),
  });
});

describe('legacy assigned-program view after guarded PLAN rollout', () => {
  it('keeps cancelled status distinct from completed when feature flag is off', () => {
    const html = renderToStaticMarkup(<ClientProgramsPage />);
    expect(html).toContain('Отменённая программа');
    expect(html).toContain('Отменена');
    expect(html).not.toContain('Завершена');
  });
});
