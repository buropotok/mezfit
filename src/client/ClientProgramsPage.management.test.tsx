import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useCloudConnections } from '../data/cloud/CloudConnectionsProvider';
import { useClientCoach } from './ClientCoachContext';
import { ClientProgramsPage } from './ClientProgramsPage';

vi.mock('../data/cloud/program-management-activation', () => ({
  CLOUD_PROGRAM_MANAGEMENT_ENABLED: true,
}));
vi.mock('../data/cloud/pilot-activation', () => ({
  CLOUD_ASSIGNED_PROGRAMS_ENABLED: false,
}));
vi.mock('../data/cloud/CloudConnectionsProvider', () => ({
  useCloudConnections: vi.fn(),
}));
vi.mock('./ClientCoachContext', () => ({
  useClientCoach: vi.fn(),
}));

const cloud = {
  db: {} as NonNullable<ReturnType<typeof useCloudConnections>>['db'],
  actorUserId: 'tg:101',
  clients: [],
  coaches: [],
  status: 'error' as const,
  error: 'Нет соединения с облаком',
  syncStatus: 'offline' as const,
  syncError: 'Облако недоступно',
  refresh: vi.fn(async () => undefined),
  retrySync: vi.fn(async () => undefined),
  loadAvatar: vi.fn(async () => null),
};
const coachContext = {
  coaches: [],
  selectedCoach: null,
  status: 'error' as const,
  error: 'Не удалось загрузить тренеров',
  selectCoach: vi.fn(),
  refreshCoaches: vi.fn(),
};

beforeEach(() => {
  vi.mocked(useCloudConnections).mockReturnValue(cloud);
  vi.mocked(useClientCoach).mockReturnValue(coachContext);
});

describe('client program directory initial states', () => {
  it('shows cloud failure and retry without a coach selection gate', () => {
    const markup = renderToStaticMarkup(<ClientProgramsPage />);
    expect(markup).toContain('Нет соединения с облаком');
    expect(markup).toContain('Повторить');
    expect(markup).not.toContain('Нет выбранного тренера');
  });

  it('shows loading before cloud confirms the available coaches', () => {
    vi.mocked(useCloudConnections).mockReturnValue({ ...cloud, status: 'loading' });
    vi.mocked(useClientCoach).mockReturnValue({ ...coachContext, status: 'loading', error: '' });
    const markup = renderToStaticMarkup(<ClientProgramsPage />);
    expect(markup).toContain('Загружаем программы');
    expect(markup).not.toContain('Нет выбранного тренера');
  });

  it('renders both directory sections without a selected coach', () => {
    vi.mocked(useCloudConnections).mockReturnValue({ ...cloud, status: 'ready', error: '' });
    vi.mocked(useClientCoach).mockReturnValue({ ...coachContext, status: 'ready', error: '' });
    const markup = renderToStaticMarkup(<ClientProgramsPage />);
    expect(markup).toContain('Мои программы');
    expect(markup).toContain('Тренерские программы');
    expect(markup).not.toContain('Нет выбранного тренера');
    expect(markup).not.toContain('Не удалось загрузить тренеров');
  });
});
