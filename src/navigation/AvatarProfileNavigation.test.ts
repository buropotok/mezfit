import { describe, expect, it } from 'vitest';
import { avatarProfileDestination } from './AvatarProfileNavigation';

describe('avatar profile routing by role and subject', () => {
  const actor = 'tg:101';
  it('opens My profile for the coach own avatar', () => {
    expect(avatarProfileDestination('coach', actor, actor)).toBe('profile');
  });
  it("opens the client's Basics workspace from a coach-viewed client avatar", () => {
    expect(avatarProfileDestination('coach', actor, 'tg:202')).toBe('clients');
  });
  it("always opens My profile for a client, including other people's avatars", () => {
    expect(avatarProfileDestination('client', actor, actor)).toBe('profile');
    expect(avatarProfileDestination('client', actor, 'tg:202')).toBe('profile');
  });
});
