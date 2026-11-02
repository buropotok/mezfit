// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { UserProfilePublicationProvider, UserProfileSyncStatus } from './UserProfilePublicationProvider';

const state = vi.hoisted(() => ({ db: {}, revision: 0, publish: vi.fn(), confirm: vi.fn() }));
vi.mock('../data/cloud/CloudConnectionsProvider', () => ({ useCloudConnections: () => ({
  db: state.db, actorUserId: 'tg:202', syncStatus: 'synced', avatarLoadRevision: state.revision,
}) }));
vi.mock('../data/cloud/user-profile', () => ({ UserProfileRepository: class {
  observePublicationVersion(next: (version: string) => void) {
    next(state.revision ? 'avatar-ready' : 'avatar-pending');
    return { unsubscribe() {} };
  }
  publishOwn() { state.publish(); return Promise.resolve(state.revision ? 'avatar-ready' : null); }
  confirmOwnSync(version: string) { state.confirm(version); return Promise.resolve(true); }
} }));
vi.mock('../ui', () => ({
  BadgeChoice: ({ children, color, onClick }: { children: ReactNode; color: string; onClick: () => void }) =>
    <button data-color={color} onClick={onClick}>{children}</button>,
  LiquidPopover: ({ trigger }: { trigger: ReactNode }) => <>{trigger}</>,
  Button: ({ children }: { children: ReactNode }) => <button>{children}</button>,
}));
afterEach(cleanup);

it('rechecks publication after Addon hydrates an avatar without another business-row mutation', async () => {
  state.revision = 0; state.publish.mockClear(); state.confirm.mockClear();
  const ui = () => <UserProfilePublicationProvider><UserProfileSyncStatus /></UserProfilePublicationProvider>;
  const view = render(ui());
  await waitFor(() => expect(state.publish).toHaveBeenCalledOnce());
  expect(screen.getByText('В ожидании').getAttribute('data-color')).toBe('yellow');
  expect(state.confirm).not.toHaveBeenCalled();
  state.revision = 1; view.rerender(ui());
  await screen.findByText('Синхронизирована');
  expect(state.publish).toHaveBeenCalledTimes(2);
  expect(state.confirm).toHaveBeenCalledWith('avatar-ready');
});
