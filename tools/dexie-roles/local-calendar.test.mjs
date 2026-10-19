import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { assertApprovedManifest, planSchedulingAcl, validateAclDispatch, verifySchedulingAcl, assertUnchangedBeforeApply } from './local-calendar.mjs';
const manifest = JSON.parse(readFileSync(new URL('../../cloud/roles.json', import.meta.url), 'utf8'));
const previous = structuredClone(manifest);
for (const [name, role] of Object.entries(previous.roles)) {
  delete role.permissions.add;
  delete role.permissions.update.workoutOccurrences;
  role.description = name === 'coach'
    ? 'Can author assigned PLAN and edit set FACT; session lifecycle stays privileged'
    : 'Can read assigned PLAN and edit only set FACT; session lifecycle stays privileged';
}
// Historical policy in cloud/roles.json at d1af376781503b5209aba8fa0e873a155d989c80.
const schedulingRequests = structuredClone(previous);
for (const [name, role] of Object.entries(schedulingRequests.roles)) {
  role.permissions.add = ['workoutScheduleRequests'];
  role.description = name === 'coach'
    ? 'Can author assigned PLAN, request scheduling, and edit set FACT; session lifecycle stays privileged'
    : 'Can read assigned PLAN, request scheduling, and edit set FACT; session lifecycle stays privileged';
}
const schema = { sealed: true, schema: { workoutOccurrences: '@id' } };
const trusted = { GITHUB_EVENT_NAME: 'workflow_dispatch', GITHUB_REF: 'refs/heads/main',
  GITHUB_ACTOR: 'buropotok', GITHUB_REPOSITORY_OWNER: 'buropotok',
  DEXIE_ACL_OPERATION: 'apply', DEXIE_ACL_CONFIRMATION: 'APPLY_LOCAL_CALENDAR_COACH_CLIENT_ACL' };
describe('protected local calendar ACL', () => {
  it('replaces the exact installed request policy and preserves PLAN, FACT and other roles', () => {
    const before = structuredClone(schedulingRequests);
    before.roles.unrelated = { permissions: { add: ['otherTable'] } };
    const untouched = structuredClone(before);
    const plan = planSchedulingAcl(manifest, schema, before);
    expect(plan.changedNames).toEqual(['coach', 'client']);
    expect(plan.importPayload).toEqual(manifest);
    expect(before).toEqual(untouched);
    for (const name of ['coach', 'client']) {
      expect(plan.importPayload.roles[name].permissions.update.sessionSetFacts)
        .toEqual(before.roles[name].permissions.update.sessionSetFacts);
      expect(plan.importPayload.roles[name].permissions.manage).toEqual(before.roles[name].permissions.manage);
      expect(plan.importPayload.roles[name].permissions.add).toEqual(['workoutOccurrences']);
    }
    const after = structuredClone({ roles: { ...before.roles, ...plan.importPayload.roles } });
    expect(() => verifySchedulingAcl(manifest, schema, before, schema, after)).not.toThrow();
    after.roles.client.permissions.add = ['workoutOccurrences', 'workoutScheduleRequests'];
    expect(() => verifySchedulingAcl(manifest, schema, before, schema, after)).toThrow('SCHEDULING_ROLE_NOT_APPLIED');
  });

  it('supports a partially upgraded cloud without reimporting an already approved role', () => {
    const before = { roles: { coach: manifest.roles.coach, client: schedulingRequests.roles.client } };
    expect(planSchedulingAcl(manifest, schema, before)).toEqual({
      changedNames: ['client'], importPayload: { roles: { client: manifest.roles.client } },
    });
  });

  describe.each(['coach', 'client'])('rejects changed historical %s permissions', name => {
    it.each([
      ['extra add grant', role => role.permissions.add.push('workoutSessions')],
      ['wrong add grant', role => { role.permissions.add = ['workoutOccurrences']; }],
      ['missing add grant', role => { delete role.permissions.add; }],
      ['different FACT', role => { role.permissions.update.sessionSetFacts = ['actualReps']; }],
      ['new manage grant', role => { role.permissions.manage = ['workoutOccurrences']; }],
      ['different description', role => { role.description = 'unexpected'; }],
    ])('%s', (_label, mutate) => {
      const before = structuredClone(schedulingRequests);
      mutate(before.roles[name]);
      expect(() => planSchedulingAcl(manifest, schema, before)).toThrow('UNEXPECTED_INSTALLED_SCHEDULING_ROLE');
    });
  });

  it('previews the historical upgrade with explicit retirement reporting and only approved role payload', () => {
    const temp = mkdtempSync(join(tmpdir(), 'calendar-acl-request-preview-'));
    const folder = join(temp, 'dexie-schema-123-1');
    mkdirSync(folder);
    writeFileSync(join(folder, 'before-schema.json'), JSON.stringify(schema));
    writeFileSync(join(folder, 'before-roles.json'), JSON.stringify(schedulingRequests));
    try {
      const result = spawnSync(process.execPath, ['tools/dexie-roles/local-calendar.mjs', 'plan'], {
        cwd: fileURLToPath(new URL('../../', import.meta.url)), encoding: 'utf8',
        env: { ...process.env, ...trusted, DEXIE_ACL_OPERATION: 'preview', DEXIE_ACL_CONFIRMATION: '',
          RUNNER_TEMP: temp, GITHUB_RUN_ID: '123', GITHUB_RUN_ATTEMPT: '1',
          GITHUB_OUTPUT: join(temp, 'output') },
      });
      expect(result.status).toBe(0);
      expect(result.stderr).toBe('');
      expect(result.stdout).toContain('Replace add-only workoutScheduleRequests grants with approved calendar grants: coach, client');
      expect(JSON.parse(readFileSync(join(folder, 'roles-only-import.json'), 'utf8'))).toEqual(manifest);
      expect(readFileSync(join(temp, 'output'), 'utf8')).toBe('change_count=2\n');
    } finally { rmSync(temp, { recursive: true, force: true }); }
  });

  it('reports both rejected roles and their grant differences against every supported policy', () => {
    const unexpected = structuredClone(previous);
    unexpected.roles.coach.permissions.update.sessionSetFacts = ['actualReps'];
    unexpected.roles.client.permissions.update.sessionSetFacts = ['actualWeightKg'];
    let failure;
    try { planSchedulingAcl(manifest, schema, unexpected); } catch (error) { failure = error; }
    expect(failure?.message).toBe('UNEXPECTED_INSTALLED_SCHEDULING_ROLE');
    expect(failure?.diagnostics.map(item => item.role)).toEqual(['coach', 'client']);
    for (const item of failure.diagnostics) {
      expect(item.comparisons.map(entry => entry.baseline))
        .toEqual(['preCalendar', 'schedulingRequests', 'calendarV1', 'approved']);
      expect(item.comparisons[0].differences).toContainEqual({
        path: '$.permissions.update.sessionSetFacts',
        expected: previous.roles[item.role].permissions.update.sessionSetFacts,
        actual: unexpected.roles[item.role].permissions.update.sessionSetFacts,
      });
    }
  });

  it('identifies missing roles, metadata and array order without accepting them', () => {
    const cases = [
      [undefined, '$', '<absent>'],
      [{ ...previous.roles.coach, description: 'private-description' }, '$.description', '<redacted:string>'],
      [{ ...previous.roles.coach, sortOrder: 2 }, '$.sortOrder', 2],
      [{ ...previous.roles.coach, permissions: { ...previous.roles.coach.permissions,
        manage: [...previous.roles.coach.permissions.manage].reverse() } }, '$.permissions.manage',
      [...previous.roles.coach.permissions.manage].reverse()],
    ];
    for (const [actual, path, value] of cases) {
      let failure;
      try { planSchedulingAcl(manifest, schema, { roles: { ...previous.roles, coach: actual } }); }
      catch (error) { failure = error; }
      expect(failure?.message).toBe('UNEXPECTED_INSTALLED_SCHEDULING_ROLE');
      expect(failure?.diagnostics[0].comparisons[0].differences).toContainEqual(
        expect.objectContaining({ path, actual: value }));
    }
  });

  it.each(['preview', 'apply'])('prints safe %s CLI diagnostics before generating any import payload', operation => {
    const temp = mkdtempSync(join(tmpdir(), 'calendar-acl-diagnostic-'));
    const folder = join(temp, 'dexie-schema-123-1');
    mkdirSync(folder);
    const unexpected = structuredClone(previous);
    unexpected.roles.coach.description = 'private-description';
    unexpected.roles.coach.realmId = 'private-realm';
    unexpected.roles.coach['private-key'] = { token: 'private-token' };
    unexpected.roles.client.permissions.update.sessionSetFacts = ['actualReps', 'private-field'];
    unexpected.roles.unrelated = { secret: 'private-unrelated' };
    writeFileSync(join(folder, 'before-schema.json'), JSON.stringify(schema));
    writeFileSync(join(folder, 'before-roles.json'), JSON.stringify(unexpected));
    try {
      const result = spawnSync(process.execPath, ['tools/dexie-roles/local-calendar.mjs', 'plan'], {
        cwd: fileURLToPath(new URL('../../', import.meta.url)), encoding: 'utf8',
        env: { ...process.env, ...trusted, DEXIE_ACL_OPERATION: operation,
          DEXIE_ACL_CONFIRMATION: operation === 'apply' ? trusted.DEXIE_ACL_CONFIRMATION : '',
          RUNNER_TEMP: temp, GITHUB_RUN_ID: '123', GITHUB_RUN_ATTEMPT: '1',
          GITHUB_OUTPUT: join(temp, 'output') },
      });
      expect(result.status).toBe(1);
      const lines = result.stderr.trim().split('\n');
      expect(lines.pop()).toBe('UNEXPECTED_INSTALLED_SCHEDULING_ROLE');
      const diagnostics = lines.map(line => JSON.parse(line));
      expect(diagnostics.map(item => item.role)).toEqual(['coach', 'client']);
      expect(result.stderr).toContain('$.realmId');
      expect(result.stderr).toContain('unexpected-key');
      expect(result.stderr).toContain('actualReps');
      expect(result.stderr).not.toContain('private-');
      expect(result.stdout).toBe('');
      expect(existsSync(join(folder, 'roles-only-import.json'))).toBe(false);
      expect(existsSync(join(temp, 'output'))).toBe(false);
    } finally { rmSync(temp, { recursive: true, force: true }); }
  });

  it('upgrades the frozen installed calendar v1 policy without touching other grants', () => {
    const v1 = structuredClone(manifest);
    for (const role of ['coach', 'client']) v1.roles[role].permissions.update.workoutOccurrences =
      v1.roles[role].permissions.update.workoutOccurrences.filter(field => !['publicationStatus', 'originalPlan', 'publishedPlan', 'draftAuthorUserId'].includes(field));
    const plan = planSchedulingAcl(manifest, schema, v1);
    expect(plan.changedNames).toEqual(['coach', 'client']);
    expect(plan.importPayload.roles).toEqual(manifest.roles);
  });

  it('accepts only the reviewed table and field grants and exact installed baseline', () => {
    expect(assertApprovedManifest(manifest)).toEqual(manifest.roles);
    const changed = structuredClone(manifest); changed.roles.client.permissions.manage = ['workoutOccurrences'];
    expect(() => assertApprovedManifest(changed)).toThrow();
    expect(planSchedulingAcl(manifest, schema, previous).changedNames).toEqual(['coach', 'client']);
    expect(planSchedulingAcl(manifest, schema, manifest).changedNames).toEqual([]);
    const unexpected = structuredClone(previous); unexpected.roles.client.permissions.add = ['workoutSessions'];
    expect(() => planSchedulingAcl(manifest, schema, unexpected)).toThrow();
  });
  it('preserves source PLAN, FACT, schema and unrelated roles', () => {
    const before = { roles: { ...previous.roles, unrelated: { permissions: {} } } };
    const after = { roles: { ...manifest.roles, unrelated: { permissions: {} } } };
    expect(() => verifySchedulingAcl(manifest, schema, before, schema, after)).not.toThrow();
    expect(() => verifySchedulingAcl(manifest, schema, before, { schema: {} }, after)).toThrow();
    expect(() => assertUnchangedBeforeApply(schema, before, schema, after)).toThrow();
  });
  it('requires protected main/owner manual dispatch and explicit confirmation', () => {
    expect(() => validateAclDispatch(trusted)).not.toThrow();
    for (const invalid of [{ GITHUB_EVENT_NAME: 'push' }, { GITHUB_REF: 'refs/heads/feature' },
      { GITHUB_ACTOR: 'outsider' }, { DEXIE_ACL_CONFIRMATION: '' }])
      expect(() => validateAclDispatch({ ...trusted, ...invalid })).toThrow();
    const workflow = readFileSync(new URL('../../.github/workflows/dexie-local-calendar-acl.yml', import.meta.url), 'utf8');
    expect(workflow).toContain('name: dexie-production');
    expect(workflow).not.toMatch(/^\s+(push|pull_request):/m);
    expect(workflow).toContain('local-calendar.mjs recheck');
    expect(workflow).toContain('local-calendar.mjs verify');
    expect(workflow).toContain('!cancelled()');
  });
});
