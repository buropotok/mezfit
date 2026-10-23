// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { ProgramSummary } from './ProgramSummary';
import type { CloudTrainingPlanRow } from '../data/cloud/database';

const state = vi.hoisted(() => ({ selfAvatars: [] as Array<{
  relationshipId: string; userId: string; displayName: string; avatarVersion: string;
}> }));
vi.mock('../data/cloud/CloudConnectionsProvider', () => ({
  useCloudConnections: () => ({ actorUserId: 'tg:101', clients: [], coaches: [],
    selfAvatars: state.selfAvatars }),
}));
vi.mock('../contacts/CloudContactAvatar', () => ({
  CloudContactAvatar: ({ contact }: { contact: { relationshipId: string } }) =>
    <span data-testid="cloud-self-portrait">{contact.relationshipId}</span>,
}));
vi.mock('./ProgramSyncControls', () => ({ ProgramSyncControls: () => null }));
vi.mock('../ui', () => ({
  Avatar: ({ src }: { src?: string }) => <span data-testid="fallback-photo">{src ?? 'initials'}</span>,
  GlassSurface: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  Text: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));
const program: CloudTrainingPlanRow = {
  id: 'plan', realmId: 'rlm' + 'a'.repeat(28), owner: null,
  athleteUserId: 'tg:202', coachUserId: 'tg:101', clientUserId: 'tg:202',
  name: 'День 1', status: 'active', position: 0,
  startedAt: null, finishedAt: null, createdAt: '', updatedAt: '',
};

afterEach(() => { cleanup(); state.selfAvatars = []; });

function show(realmId = program.realmId) {
  return render(<ProgramSummary program={{ ...program, realmId }} phaseCount={1}
    actorUserId="tg:101" actor={{ name: 'Coach', photoUrl: '/stale-telegram-me.jpg' }}
    repository={{} as Parameters<typeof ProgramSummary>[0]['repository']}
    syncStatus="synced" onSync={async () => {}} />);
}

describe('program author portrait', () => {
  it('renders the current own cloud avatar instead of the stale /me photo', () => {
    state.selfAvatars = [{ relationshipId: program.realmId, userId: 'tg:101',
      displayName: 'Coach', avatarVersion: 'a'.repeat(64) }];
    show();
    expect(screen.getByTestId('cloud-self-portrait').textContent).toBe(program.realmId);
    expect(screen.queryByText('/stale-telegram-me.jpg')).toBeNull();
  });

  it('does not reuse a self profile from a different relationship', () => {
    state.selfAvatars = [{ relationshipId: 'rlm' + 'b'.repeat(28), userId: 'tg:101',
      displayName: 'Coach', avatarVersion: 'a'.repeat(64) }];
    show();
    expect(screen.queryByTestId('cloud-self-portrait')).toBeNull();
    expect(screen.getByTestId('fallback-photo').textContent).toBe('/stale-telegram-me.jpg');
  });
});
