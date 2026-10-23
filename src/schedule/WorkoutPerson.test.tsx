// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useWorkoutPerson } from './WorkoutPerson';

const cloudState = vi.hoisted(() => ({ selfAvatars: [] as Array<{
  userId: string; relationshipId: string; displayName: string; avatarVersion: string | null;
}> }));
vi.mock('../data/cloud/CloudConnectionsProvider', () => ({ useCloudConnections: () => ({
  actorUserId: 'tg:101', clients: [{ userId: 'tg:202', relationshipId: 'pair', displayName: 'Клиент' }],
  coaches: [], selfAvatars: cloudState.selfAvatars,
}) }));
vi.mock('../contacts/CloudContactAvatar', () => ({ CloudContactAvatar: () => <span>Фото контакта</span> }));
function Person({ id }: { id: string }) {
  const person = useWorkoutPerson(id, 'pair', { name: 'Андрей', photoUrl: '/me.jpg' });
  return <div>{person.name}{person.avatar}</div>;
}
afterEach(() => { cleanup(); cloudState.selfAvatars = []; });
it('uses the current athlete name and photograph rather than a program day title', () => {
  const { container } = render(<Person id="tg:101" />);
  expect(screen.getByText('Андрей')).toBeTruthy();
  expect(container.querySelector('img')?.getAttribute('src')).toBe('/me.jpg');
});
it('resolves a contact by the athlete and relationship', () => {
  render(<Person id="tg:202" />);
  expect(screen.getByText('Фото контакта')).toBeTruthy();
  expect(screen.getByText('Клиент')).toBeTruthy();
});

it('uses the updated Dexie Cloud photo for the coach viewing their own authored workout', () => {
  cloudState.selfAvatars = [{ userId: 'tg:101', relationshipId: 'pair',
    displayName: 'Coach', avatarVersion: 'f'.repeat(64) }];
  const { container } = render(<Person id="tg:101" />);
  expect(screen.getByText('Андрей')).toBeTruthy();
  expect(screen.getByText('Фото контакта')).toBeTruthy();
  expect(container.querySelector('img[src="/me.jpg"]')).toBeNull();
});
it('does not borrow a self avatar from a different coach-client relationship', () => {
  cloudState.selfAvatars = [{ userId: 'tg:101', relationshipId: 'another-pair',
    displayName: 'Coach', avatarVersion: 'f'.repeat(64) }];
  const { container } = render(<Person id="tg:101" />);
  expect(container.querySelector('img')?.getAttribute('src')).toBe('/me.jpg');
});
