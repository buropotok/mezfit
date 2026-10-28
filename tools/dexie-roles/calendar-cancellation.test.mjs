import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ADHOC_SCHEMA } from './adhoc-sessions.mjs';
import { EXPECTED_PLANNED_ROLES } from './planned-sessions.mjs';
import { CONFIRMATION, EXPECTED_CANCELLATION_ROLES, CANCELLATION_ROLE_OVERLAY,
  planCalendarCancellation, verifyCalendarCancellation, validateCancellationDispatch,
  assertUnchangedBeforeApply, assertExactImportPayload } from './calendar-cancellation.mjs';

const overlay = JSON.parse(readFileSync(new URL('../../cloud/calendar-cancellation-roles.json', import.meta.url), 'utf8'));
const schema = { schema: { workoutOccurrences: '@id', ...ADHOC_SCHEMA.schema, other: 'id' }, marker: 'retained' };
const roles = { roles: { ...structuredClone(EXPECTED_PLANNED_ROLES), unrelated: { permissions: { add: ['other'] } } }, marker: 'retained' };
const target = () => ({ ...structuredClone(roles), roles: { ...structuredClone(roles.roles), ...structuredClone(EXPECTED_CANCELLATION_ROLES) } });
const trusted = { GITHUB_EVENT_NAME: 'workflow_dispatch', GITHUB_REF: 'refs/heads/main',
  GITHUB_ACTOR: 'buropotok', GITHUB_REPOSITORY_OWNER: 'buropotok', DEXIE_CANCELLATION_OPERATION: 'preview' };

describe('protected logical-deletion ACL', () => {
  it('adds only inactive to the exact existing Coach and Client occurrence update fields', () => {
    expect(overlay).toEqual(CANCELLATION_ROLE_OVERLAY);
    const expected = structuredClone(EXPECTED_PLANNED_ROLES);
    for (const name of ['coach', 'client']) expected[name].permissions.update.workoutOccurrences.push('inactive');
    expect(EXPECTED_CANCELLATION_ROLES).toEqual(expected);
    const before = structuredClone({ schema, roles });
    expect(planCalendarCancellation(overlay, schema, roles)).toEqual({
      importPayload: { roles: structuredClone(EXPECTED_CANCELLATION_ROLES) }, changedRoles: ['coach', 'client'], changeCount: 2,
    });
    expect({ schema, roles }).toEqual(before);
    expect(planCalendarCancellation(overlay, schema, target()).changeCount).toBe(0);
    for (const role of Object.values(expected)) expect(role.permissions).not.toHaveProperty('delete');
  });
  it.each([
    r => { r.roles.coach.permissions.update.workoutOccurrences.push('inactive'); },
    r => { r.roles.client.permissions.update.workoutOccurrences.push('inactive'); },
    r => { r.roles.coach.permissions.delete = ['workoutOccurrences']; },
    r => { r.roles.coach.permissions.update.adHocSessions.push('owner'); },
    r => { r.roles.client.description = 'drift'; },
  ])('rejects partial or broadened installed policies', mutate => {
    const changed = structuredClone(roles); mutate(changed);
    expect(() => planCalendarCancellation(overlay, schema, changed)).toThrow();
  });
  it('rejects manifest/schema expansion and any unexpected final readback', () => {
    const expanded = structuredClone(overlay); expanded.roles.coach.permissions.update.workoutOccurrences.push('realmId');
    expect(() => planCalendarCancellation(expanded, schema, roles)).toThrow('INVALID_CANCELLATION_ROLE_OVERLAY');
    const incompatible = structuredClone(schema); incompatible.schema.workoutOccurrences = 'id';
    expect(() => planCalendarCancellation(overlay, incompatible, roles)).toThrow();
    expect(() => verifyCalendarCancellation(overlay, schema, roles, schema, target())).not.toThrow();
    expect(() => verifyCalendarCancellation(overlay, schema, roles, schema, roles)).toThrow('UNEXPECTED_ROLES_READBACK');
    const drifted = target(); delete drifted.roles.unrelated;
    expect(() => verifyCalendarCancellation(overlay, schema, roles, schema, drifted)).toThrow();
    expect(() => verifyCalendarCancellation(overlay, schema, roles, { ...schema, marker: 'changed' }, target())).toThrow();
    expect(() => assertUnchangedBeforeApply(schema, roles, schema, target())).toThrow();
    expect(() => assertExactImportPayload({}, { data: {} })).toThrow();
  });
  it('permits only owner/main manual dispatch, explicit apply and empty preview confirmation', () => {
    expect(() => validateCancellationDispatch(trusted)).not.toThrow();
    const apply = { ...trusted, DEXIE_CANCELLATION_OPERATION: 'apply', DEXIE_CANCELLATION_CONFIRMATION: CONFIRMATION };
    expect(() => validateCancellationDispatch(apply)).not.toThrow();
    for (const change of [{ GITHUB_EVENT_NAME: 'pull_request' }, { GITHUB_REF: 'refs/heads/feature' }, { GITHUB_ACTOR: 'other' }])
      expect(() => validateCancellationDispatch({ ...apply, ...change })).toThrow();
    expect(() => validateCancellationDispatch({ ...apply, DEXIE_CANCELLATION_CONFIRMATION: '' })).toThrow();
    expect(() => validateCancellationDispatch({ ...trusted, DEXIE_CANCELLATION_CONFIRMATION: CONFIRMATION })).toThrow();
  });
  it('keeps workflow writes protected, rechecked, and read back after failed imports or no-op apply', () => {
    const workflow = readFileSync(new URL('../../.github/workflows/dexie-calendar-cancellation.yml', import.meta.url), 'utf8');
    expect(workflow).not.toMatch(/^\s+(push|pull_request|issues|schedule):/m);
    expect(workflow).toContain('name: dexie-production');
    expect(workflow).toContain('group: dexie-public-catalogue-publishing');
    expect(workflow).toContain('secrets.DEXIE_CLOUD_WRITE_KEY');
    expect(workflow).toContain("github.actor == github.repository_owner");
    expect(workflow.indexOf('calendar-cancellation.mjs recheck')).toBeLessThan(workflow.indexOf('dexie-cloud import cancellation-proposal.json'));
    expect(workflow.match(/if: \$\{\{ !cancelled\(\)/g)).toHaveLength(2);
    expect(workflow).toContain("steps.plan.outputs.change_count == '0'");
    expect(workflow).toContain("steps.import_attempt.outputs.attempted == 'true'");
    expect(workflow).toContain('calendar-cancellation.mjs verify');
    expect(workflow).toContain('if: always()');
  });
});
