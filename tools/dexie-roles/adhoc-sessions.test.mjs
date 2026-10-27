import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  ADHOC_ROLE_OVERLAY, ADHOC_SCHEMA, CONFIRMATION, EXPECTED_CALENDAR_ROLES,
  EXPECTED_ADHOC_ROLES, assertApprovedManifests, assertExactImportPayload,
  assertUnchangedBeforeApply, buildExpectedAdHocRoles, planAdHocSessions,
  validateAdHocDispatch, verifyAdHocSessions,
} from './adhoc-sessions.mjs';

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const overlay = JSON.parse(read('../../cloud/adhoc-session-roles.json'));
const schemaManifest = JSON.parse(read('../../cloud/schema-adhoc-sessions.json'));
const schema = { sealed: true, schema: { workoutOccurrences: '@id', existing: 'id' }, metadata: { retained: true } };
const roles = { roles: { ...structuredClone(EXPECTED_CALENDAR_ROLES), unrelated: { permissions: { add: ['existing'] } } }, metadata: 'retained' };
const afterSchema = () => ({ ...structuredClone(schema), schema: { ...schema.schema, ...ADHOC_SCHEMA.schema } });
const afterRoles = () => ({ ...structuredClone(roles), roles: { ...structuredClone(roles.roles), coach: structuredClone(EXPECTED_ADHOC_ROLES.coach) } });
const plan = (s = schema, r = roles) => planAdHocSessions(overlay, schemaManifest, s, r);
const trusted = { GITHUB_EVENT_NAME: 'workflow_dispatch', GITHUB_REF: 'refs/heads/main',
  GITHUB_ACTOR: 'buropotok', GITHUB_REPOSITORY_OWNER: 'buropotok',
  DEXIE_ADHOC_OPERATION: 'apply', DEXIE_ADHOC_CONFIRMATION: CONFIRMATION };

describe('protected ad-hoc session schema and ACL exception', () => {
  it('pins both manifests and the existing calendar baseline independently', () => {
    expect(() => assertApprovedManifests(overlay, schemaManifest)).not.toThrow();
    expect(overlay).toEqual(ADHOC_ROLE_OVERLAY);
    expect(schemaManifest).toEqual(ADHOC_SCHEMA);
    expect(JSON.parse(read('../../cloud/roles.json')).roles).toEqual(EXPECTED_CALENDAR_ROLES);
    expect(buildExpectedAdHocRoles()).toEqual(EXPECTED_ADHOC_ROLES);
    const changed = structuredClone(EXPECTED_CALENDAR_ROLES);
    changed.coach.permissions.manage.push('workoutSessions');
    expect(() => buildExpectedAdHocRoles(changed)).toThrow('UNEXPECTED_CALENDAR_BASELINE');
    expect(Object.isFrozen(EXPECTED_ADHOC_ROLES.coach.permissions.add)).toBe(true);
  });

  it('changes only the three reviewed tables and Coach add/update grants', () => {
    const before = structuredClone({ schema, roles });
    const result = plan();
    expect(result.addedTables).toEqual(['adHocSessions', 'adHocExercises', 'adHocSets']);
    expect(result.changedRoles).toEqual(['coach']);
    expect(result.importPayload).toEqual({ schema: ADHOC_SCHEMA.schema, roles: { coach: EXPECTED_ADHOC_ROLES.coach } });
    expect({ schema, roles }).toEqual(before);
    const coach = structuredClone(EXPECTED_ADHOC_ROLES.coach);
    coach.permissions.add = coach.permissions.add.filter(table => !Object.hasOwn(ADHOC_SCHEMA.schema, table));
    for (const table of Object.keys(ADHOC_SCHEMA.schema)) delete coach.permissions.update[table];
    expect(coach).toEqual(EXPECTED_CALENDAR_ROLES.coach);
    expect(EXPECTED_ADHOC_ROLES.client).toEqual(EXPECTED_CALENDAR_ROLES.client);
    for (const fields of Object.values(overlay.roles.coach.permissions.update)) {
      for (const key of ['id', 'owner', 'realmId', 'athleteUserId', 'creatorUserId', 'sessionId', 'exerciseId']) {
        expect(fields).not.toContain(key);
      }
    }
    expect(Object.keys(overlay.roles.coach.permissions)).toEqual(['add', 'update']);
  });

  it('supports no-op and exact interrupted-import recovery without replaying installed changes', () => {
    expect(plan(afterSchema(), afterRoles())).toEqual({ importPayload: {}, addedTables: [], changedRoles: [], changeCount: 0 });
    expect(plan(afterSchema()).importPayload).toEqual({ roles: { coach: EXPECTED_ADHOC_ROLES.coach } });
    expect(plan(schema, afterRoles()).importPayload).toEqual({ schema: ADHOC_SCHEMA.schema });
    const partial = structuredClone(schema); partial.schema.adHocSessions = '@id';
    expect(plan(partial).addedTables).toEqual(['adHocExercises', 'adHocSets']);
  });

  it.each([
    value => { value.roles.client = { permissions: { add: ['adHocSessions'] } }; },
    value => { value.roles.coach.permissions.update.adHocSessions = ['owner']; },
    value => { value.roles.coach.permissions.add.push('workoutSessions'); },
    value => { value.roles.coach.permissions.delete = ['adHocSets']; },
    value => { value.roles.coach.description = 'drift'; },
    value => { delete value.roles.coach; },
  ])('rejects installed role drift', mutate => {
    const changed = structuredClone(roles); mutate(changed);
    expect(() => plan(schema, changed)).toThrow();
  });

  it.each([
    value => { value.roles.coach.permissions.update.adHocSessions.push('realmId'); },
    value => { value.roles.client = { permissions: { add: ['adHocSessions'] } }; },
    value => { value.data = { adHocSessions: [] }; },
  ])('rejects any broadened overlay', mutate => {
    const changed = structuredClone(overlay); mutate(changed);
    expect(() => planAdHocSessions(changed, schemaManifest, schema, roles)).toThrow('INVALID_ADHOC_ROLE_OVERLAY');
  });

  it('rejects incompatible keys, broadened schema manifests and malformed exports', () => {
    const incompatible = afterSchema(); incompatible.schema.adHocSessions = 'id';
    expect(() => plan(incompatible)).toThrow('INCOMPATIBLE_ADHOC_TABLE');
    for (const changed of [{ schema: { ...ADHOC_SCHEMA.schema, extra: '@id' } }, { ...schemaManifest, sealed: false }]) {
      expect(() => planAdHocSessions(overlay, changed, schema, roles)).toThrow('INVALID_ADHOC_SCHEMA_MANIFEST');
    }
    for (const invalid of [null, {}, { schema: [] }]) expect(() => plan(invalid)).toThrow();
  });

  it('requires exact full-envelope readback, preserving seal, old grants, unrelated roles and metadata', () => {
    const verify = (s, r) => verifyAdHocSessions(overlay, schemaManifest, schema, roles, s, r);
    expect(() => verify(afterSchema(), afterRoles())).not.toThrow();
    for (const mutate of [s => { s.sealed = false; }, s => { s.schema.extra = '@id'; },
      s => { delete s.schema.existing; }, s => { s.schema.existing = '@id'; },
      s => { delete s.schema.adHocSets; }, s => { s.metadata.retained = false; }]) {
      const changed = afterSchema(); mutate(changed);
      expect(() => verify(changed, afterRoles())).toThrow('UNEXPECTED_SCHEMA_READBACK');
    }
    for (const mutate of [r => { delete r.roles.unrelated; }, r => { r.roles.extra = {}; },
      r => { r.roles.client.permissions.add.push('adHocSets'); },
      r => { r.roles.coach.permissions.update.sessionSetFacts.push('owner'); },
      r => { r.metadata = 'changed'; }]) {
      const changed = afterRoles(); mutate(changed);
      expect(() => verify(afterSchema(), changed)).toThrow('UNEXPECTED_ROLES_READBACK');
    }
  });

  it('rejects concurrent configuration changes and tampered generated payloads', () => {
    expect(() => assertUnchangedBeforeApply(schema, roles, structuredClone(schema), structuredClone(roles))).not.toThrow();
    expect(() => assertUnchangedBeforeApply(schema, roles, afterSchema(), roles)).toThrow();
    expect(() => assertUnchangedBeforeApply(schema, roles, schema, afterRoles())).toThrow();
    const payload = plan().importPayload;
    expect(() => assertExactImportPayload(payload, structuredClone(payload))).not.toThrow();
    expect(() => assertExactImportPayload(payload, { ...payload, data: {} })).toThrow();
  });

  it('requires owner/main manual dispatch with preview and apply kept distinct', () => {
    expect(() => validateAdHocDispatch(trusted)).not.toThrow();
    expect(() => validateAdHocDispatch({ ...trusted, DEXIE_ADHOC_OPERATION: 'preview', DEXIE_ADHOC_CONFIRMATION: '' })).not.toThrow();
    for (const change of [{ GITHUB_EVENT_NAME: 'push' }, { GITHUB_EVENT_NAME: 'pull_request' },
      { GITHUB_REF: 'refs/heads/feature' }, { GITHUB_ACTOR: 'outsider' }, { GITHUB_ACTOR: '' },
      { DEXIE_ADHOC_OPERATION: 'other' }, { DEXIE_ADHOC_CONFIRMATION: '' },
      { DEXIE_ADHOC_OPERATION: 'preview' }]) {
      expect(() => validateAdHocDispatch({ ...trusted, ...change })).toThrow();
    }
  });

  it('uses existing protected credentials, shared concurrency, immediate recheck and failure readback', () => {
    const workflow = read('../../.github/workflows/dexie-adhoc-sessions.yml');
    expect(workflow).toContain('name: dexie-production');
    expect(workflow).toContain('secrets.DEXIE_CLOUD_WRITE_KEY');
    expect(workflow).toContain('group: dexie-public-catalogue-publishing');
    expect(workflow).toContain("github.actor == github.repository_owner");
    expect(workflow).toContain("github.ref == 'refs/heads/main'");
    expect(workflow).not.toMatch(/^\s+(push|pull_request):/m);
    expect(workflow).toContain('adhoc-sessions.mjs recheck');
    expect(workflow).toContain('adhoc-sessions.mjs verify');
    expect(workflow).toContain('!cancelled()');
    expect(workflow).toContain('if: always()');
    expect(workflow).not.toContain('upload-artifact');
    expect(workflow).toContain('dexie-cloud@3.0.7');
  });

  it.each(['approved', 'unauthorized', 'unexpected-role'])('CLI preview: %s', scenario => {
    const temp = mkdtempSync(join(tmpdir(), 'adhoc-config-preview-'));
    const folder = join(temp, 'dexie-schema-123-1');
    mkdirSync(folder);
    const beforeRoles = structuredClone(roles);
    if (scenario === 'unexpected-role') beforeRoles.roles.coach.description = 'private-cloud-description';
    writeFileSync(join(folder, 'before-schema.json'), JSON.stringify(schema));
    writeFileSync(join(folder, 'before-roles.json'), JSON.stringify(beforeRoles));
    try {
      const result = spawnSync(process.execPath, ['tools/dexie-roles/adhoc-sessions.mjs', 'plan'], {
        cwd: fileURLToPath(new URL('../../', import.meta.url)), encoding: 'utf8',
        env: { ...process.env, ...trusted, DEXIE_ADHOC_OPERATION: 'preview', DEXIE_ADHOC_CONFIRMATION: '',
          GITHUB_ACTOR: scenario === 'unauthorized' ? 'outsider' : trusted.GITHUB_ACTOR,
          RUNNER_TEMP: temp, GITHUB_RUN_ID: '123', GITHUB_RUN_ATTEMPT: '1',
          GITHUB_OUTPUT: join(temp, 'output') },
      });
      if (scenario === 'approved') {
        expect(result.status).toBe(0);
        expect(result.stderr).toBe('');
        expect(JSON.parse(readFileSync(join(folder, 'adhoc-import.json'), 'utf8'))).toEqual(plan().importPayload);
        expect(readFileSync(join(temp, 'output'), 'utf8')).toBe('change_count=4\n');
      } else {
        expect(result.status).toBe(1);
        expect(result.stdout).toBe('');
        expect(result.stderr.trim()).toBe(scenario === 'unauthorized'
          ? 'UNAUTHORIZED_ADHOC_DISPATCH' : 'UNEXPECTED_COACH_ROLE');
        expect(result.stderr).not.toContain('private-cloud-description');
        expect(existsSync(join(folder, 'adhoc-import.json'))).toBe(false);
        expect(existsSync(join(temp, 'output'))).toBe(false);
      }
    } finally { rmSync(temp, { recursive: true, force: true }); }
  });
});
