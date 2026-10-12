import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useAssignedPrograms } from '../data/cloud/AssignedProgramsProvider';
import { useClientCoach } from './ClientCoachContext';
import { ClientProgramsPage } from './ClientProgramsPage';

vi.mock('../data/cloud/AssignedProgramsProvider', () => ({ useAssignedPrograms: vi.fn() }));
vi.mock('./ClientCoachContext', () => ({ useClientCoach: vi.fn() }));

const coach = {
  relationshipId: 1,
  user: {
    id: 25, telegramUserId: '202', firstName: 'Тренер', lastName: null,
    username: null, languageCode: 'ru', photoUrl: null, isPremium: false,
  },
};

beforeEach(() => {
  vi.mocked(useClientCoach).mockReturnValue({
    coaches: [coach],
    selectedCoach: coach,
    status: 'ready',
    error: '',
    selectCoach: vi.fn(),
    refreshCoaches: vi.fn(),
  });
  vi.mocked(useAssignedPrograms).mockReturnValue({
    actorUserId: 'tg:101',
    plans: [
      { id: 'tra1', realmId: 'rlm1', owner: null, coachUserId: 'tg:202', clientUserId: 'tg:101', name: 'Моя программа', position: 0, status: 'draft', startedAt: null, finishedAt: null, createdAt: '', updatedAt: '' },
      { id: 'tra2', realmId: 'rlm2', owner: null, coachUserId: 'tg:303', clientUserId: 'tg:101', name: 'Другой тренер', position: 0, status: 'draft', startedAt: null, finishedAt: null, createdAt: '', updatedAt: '' },
      { id: 'tra3', realmId: 'rlm1', owner: null, coachUserId: 'tg:202', clientUserId: 'tg:404', name: 'Другой клиент', position: 0, status: 'draft', startedAt: null, finishedAt: null, createdAt: '', updatedAt: '' },
    ],
    status: 'ready',
    error: '',
    repository: {} as NonNullable<ReturnType<typeof useAssignedPrograms>>['repository'],
    refresh: vi.fn(),
  });
});

describe('client cloud-assigned programs', () => {
  it('shows only the verified account and currently selected coach program', () => {
    const html = renderToStaticMarkup(<ClientProgramsPage />);
    expect(html).toContain('Моя программа');
    expect(html).not.toContain('Другой тренер');
    expect(html).not.toContain('Другой клиент');
  });

  it('shows an error with a retry control instead of claiming empty programs', () => {
    const current = vi.mocked(useAssignedPrograms)();
    if (!current) throw new Error('Expected cloud context');
    vi.mocked(useAssignedPrograms).mockReturnValue({ ...current, status: 'error', error: 'offline' });
    const html = renderToStaticMarkup(<ClientProgramsPage />);
    expect(html).toContain('Не удалось загрузить программы');
    expect(html).toContain('Повторить');
    expect(html).not.toContain('Программ пока нет');
  });
});
