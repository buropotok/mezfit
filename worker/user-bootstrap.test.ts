import { describe, expect, it } from 'vitest';
import workerSource from './index.ts?raw';

const source = workerSource;

describe('user bootstrap', () => {
  it('resolves an existing app_user before attempting a write', () => {
    const start = source.indexOf('async function resolveUser');
    const end = source.indexOf('async function getRoles', start);
    const resolveUser = source.slice(start, end);

    expect(start).toBeGreaterThanOrEqual(0);
    expect(resolveUser.indexOf('SELECT id, telegram_user_id')).toBeGreaterThanOrEqual(0);
    expect(resolveUser.indexOf('INSERT INTO app_user')).toBeGreaterThan(resolveUser.indexOf('SELECT id, telegram_user_id'));
    expect(resolveUser).toContain('if (existing) return existing;');
    expect(resolveUser).not.toContain('DO UPDATE SET');
  });

  it('keeps new-user creation as the only write path in authentication', () => {
    expect(source).not.toContain('async function upsertUser');
    expect(source).toContain('const row = await resolveUser(env.DB_BINDING, validated.user);');
  });
});
