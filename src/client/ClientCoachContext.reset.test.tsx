// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ClientCoachProvider, useClientCoach } from './ClientCoachContext';

const first = { relationshipId: 'rlm1', userId: 'tg:101', telegramUserId: '101', displayName: 'Тренер 1' };
const second = { relationshipId: 'rlm2', userId: 'tg:303', telegramUserId: '303', displayName: 'Тренер 2' };
const cloud = { status: 'ready', error: '', coaches: [first, second], refresh: vi.fn() };
vi.mock('../data/cloud/CloudConnectionsProvider', () => ({ useCloudConnections: () => cloud }));

function Selection() {
  const { selectedCoach } = useClientCoach();
  return <div>{selectedCoach?.userId ?? 'Нет тренера'}</div>;
}

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  cloud.coaches = [first, second];
});

describe('Client selection after test realm reset', () => {
  it('removes a deleted selected Coach and selects another accessible relationship', async () => {
    const view = () => <ClientCoachProvider clientTelegramUserId="202" enabled><Selection /></ClientCoachProvider>;
    const result = render(view());
    await screen.findByText('tg:101');
    cloud.coaches = [second];
    result.rerender(view());
    await screen.findByText('tg:303');
    expect(window.localStorage.getItem('mezfit.selectedCloudCoachUserId.202')).toBe('tg:303');
    cloud.coaches = [];
    result.rerender(view());
    await screen.findByText('Нет тренера');
    await waitFor(() => expect(window.localStorage.getItem('mezfit.selectedCloudCoachUserId.202')).toBeNull());
  });
});
