import { describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { EXPECTED_FLEX_ROLES } from './flex-attributes.mjs';
import { addRepeatPermission } from './calendar-repeat.mjs';
import { DISCUSSION_SCHEMA, DISCUSSION_ROLE_OVERLAY, EXPECTED_DISCUSSION_ROLES, LEGACY_DISCUSSION_ROLES,
  planDiscussions, verifyDiscussions, assertDiscussionUnchanged, discussionRoleDiagnostics } from './discussions.mjs';
const schema = { schema: { workoutOccurrences: '@id', otherTable: 'id' }, sealed: true };
const installed = () => ({ roles: { ...addRepeatPermission(EXPECTED_FLEX_ROLES), unrelated: { permissions: { add: ['privateTable'] } } } });
const plan = roles => planDiscussions(DISCUSSION_ROLE_OVERLAY, DISCUSSION_SCHEMA, schema, roles);
function reversed(source) {
  const result = structuredClone(source);
  for (const name of ['coach', 'client']) {
    const permissions = result.roles[name].permissions;
    permissions.add.reverse(); permissions.manage?.reverse();
    for (const fields of Object.values(permissions.update)) fields.reverse();
  }
  return result;
}

describe('Discussions Preview on the confirmed Flex + repetition policy', () => {
  it('preserves all existing rights and row metadata; adds only the discussion overlay', () => {
    const before = reversed(installed()), snapshot = structuredClone(before);
    const result = plan(before);
    expect(result.sourceProfile).toBe('flex-repeat');
    expect(result.changedRoles).toEqual(['coach', 'client']);
    expect(before).toEqual(snapshot);
    expect(result.importPayload.schema).toEqual(DISCUSSION_SCHEMA.schema);
    expect(result.importPayload.roles).not.toHaveProperty('unrelated');
    for (const name of ['coach', 'client']) {
      const next = result.importPayload.roles[name], old = before.roles[name];
      expect(next).toEqual({ ...old, permissions: { ...old.permissions,
        add: [...old.permissions.add, ...DISCUSSION_ROLE_OVERLAY.roles[name].permissions.add],
        update: { ...old.permissions.update, discussionThreads: ['lastActivityAt'] } } });
      expect(next.permissions.update.workoutOccurrences).toEqual(old.permissions.update.workoutOccurrences);
      expect(next.permissions.update.workoutOccurrences).toContain('pendingRepeatRule');
      expect(next.permissions.update.sessionSetFacts).toEqual(old.permissions.update.sessionSetFacts);
    }
    const noRepeat = plan({ roles: structuredClone(EXPECTED_FLEX_ROLES) });
    expect(noRepeat.importPayload.roles.coach.permissions.update.workoutOccurrences).not.toContain('pendingRepeatRule');
  });
  it('accepts only full text/MVP policies on the exact repetition baseline', () => {
    for (const [profile, expected] of [[LEGACY_DISCUSSION_ROLES, 'discussion-text-repeat'], [EXPECTED_DISCUSSION_ROLES, 'discussion-mvp-repeat']]) {
      const roles = { roles: addRepeatPermission(profile) };
      const result = plan(roles);
      expect(result.sourceProfile).toBe(expected);
      expect(result.changedRoles).toHaveLength(expected.includes('text') ? 2 : 0);
    }
    for (const mutate of [
      roles => roles.roles.client.permissions.update.workoutOccurrences.pop(),
      roles => roles.roles.coach.permissions.add.push('unknownTable'),
      roles => roles.roles.client.permissions.update.sessionSetFacts.push('owner'),
      roles => roles.roles.coach.permissions.manage.push('discussionMessages'),
      roles => roles.roles.client.permissions.add.push('workoutOccurrences'),
      roles => roles.roles.coach.permissions.manage.push('trainingPlans'),
      roles => roles.roles.client.permissions.update.workoutOccurrences.push('pendingRepeatRule'),
      roles => { delete roles.roles.client; },
    ]) { const roles = installed(); mutate(roles); expect(() => plan(roles)).toThrow('UNEXPECTED_DISCUSSION_ROLE_BASELINE'); }
  });
  it('treats only permission arrays as unordered sets and never hides duplicates or metadata changes', () => {
    expect(plan(reversed(installed())).sourceProfile).toBe('flex-repeat');
    const wrong = installed(); wrong.roles.coach.sortOrder = 7;
    expect(() => plan(wrong)).toThrow();
    const mixed = installed(); mixed.roles.client = structuredClone(EXPECTED_FLEX_ROLES.client);
    expect(() => plan(mixed)).toThrow();
  });
  it('explains existing repetition permissions, missing grants, dangerous additions and mixed profiles safely', () => {
    const roles = installed(); roles.roles.client.permissions.update.sessionSetFacts.push('owner');
    roles.roles.coach.permissions.add = [];
    roles.roles.coach.displayName = 'SECRET_METADATA';
    roles.roles.client.permissions.update['SECRET_TABLE'] = ['SECRET_FIELD'];
    const report = discussionRoleDiagnostics(roles);
    expect(report[0].role).toBe('coach'); expect(report[1].role).toBe('client');
    expect(report[0].differences.find(row => row.path === 'permissions.add').missing).toContain('workoutOccurrences');
    const repeat = report[1].differences.find(row => row.path === 'permissions.update.workoutOccurrences');
    expect(repeat.installedOnly).toContainEqual({ permission: 'pendingRepeatRule', classification: 'approved-existing:calendar-repeat' });
    expect(report[1].differences.find(row => row.path === 'permissions.update.sessionSetFacts').installedOnly)
      .toContainEqual({ permission: 'owner', classification: 'unknown-or-unapproved' });
    expect(report[0].metadataDifferences).toEqual(['displayName']);
    expect(JSON.stringify(report)).not.toMatch(/SECRET_|privateTable/);
    const mixed = installed(); mixed.roles.client = structuredClone(EXPECTED_FLEX_ROLES.client);
    expect(discussionRoleDiagnostics(mixed).map(row => row.matches)).toEqual([['flex-repeat'], ['flex']]);
    const malformed = installed(); malformed.roles.coach.permissions.update = JSON.parse('{"constructor":["SECRET_VALUE"]}');
    expect(() => discussionRoleDiagnostics(malformed)).not.toThrow();
    expect(JSON.stringify(discussionRoleDiagnostics(malformed))).not.toContain('SECRET_VALUE');
  });
  it('checks complete before/after state, preserving repetition, other roles, tables and metadata', () => {
    const before = installed(), delta = plan(before);
    const afterSchema = { ...schema, schema: { ...schema.schema, ...DISCUSSION_SCHEMA.schema } };
    const afterRoles = { roles: { ...before.roles, ...delta.importPayload.roles } };
    const verify = (s = afterSchema, r = afterRoles) => verifyDiscussions(DISCUSSION_ROLE_OVERLAY, DISCUSSION_SCHEMA, schema, before, s, r);
    expect(() => verify(afterSchema, reversed(afterRoles))).not.toThrow();
    expect(() => assertDiscussionUnchanged(schema, before, schema, reversed(before))).not.toThrow();
    for (const mutate of [
      r => r.roles.client.permissions.update.workoutOccurrences.pop(),
      r => { r.roles.unrelated.permissions.add = []; },
      r => { r.roles.coach.description = 'changed'; },
      r => r.roles.coach.permissions.add.push('newTable'),
    ]) { const wrong = structuredClone(afterRoles); mutate(wrong); expect(() => verify(afterSchema, wrong)).toThrow('UNEXPECTED_DISCUSSION_ROLES_READBACK'); }
    expect(() => verify({ ...afterSchema, sealed: false })).toThrow('UNEXPECTED_DISCUSSION_SCHEMA_READBACK');
    expect(() => verify(afterSchema, before)).toThrow();
    expect(() => assertDiscussionUnchanged(schema, before, schema, afterRoles)).toThrow();
  });
  it('prints a safe diagnostic on CLI Preview failure without importing or exposing raw exports or credentials', () => {
    const root = mkdtempSync(join(tmpdir(), 'discussion-preview-'));
    try {
      const runner = join(root, 'runner'), dir = join(runner, 'dexie-schema-1-1');
      mkdirSync(dir, { recursive: true }); mkdirSync(join(root, 'cloud'));
      const roles = installed(); roles.roles.coach.permissions.add.push('SECRET_PERMISSION');
      roles.roles.client.displayName = 'SECRET_USER';
      roles.members = [{ userId: 'SECRET_MEMBERSHIP' }];
      const roleFile = JSON.stringify(roles), schemaFile = JSON.stringify(schema);
      writeFileSync(join(dir, 'before-roles.json'), roleFile); writeFileSync(join(dir, 'before-schema.json'), schemaFile);
      writeFileSync(join(root, 'dexie-cloud.json'), JSON.stringify({ dbUrl: 'https://zjv60oxag.dexie.cloud' }));
      writeFileSync(join(root, 'cloud/discussion-roles.json'), JSON.stringify(DISCUSSION_ROLE_OVERLAY));
      writeFileSync(join(root, 'cloud/schema-discussions.json'), JSON.stringify(DISCUSSION_SCHEMA));
      const options = {
        cwd: root, encoding: 'utf8', env: { ...process.env,
          GITHUB_EVENT_NAME: 'workflow_dispatch', GITHUB_REF: 'refs/heads/main', GITHUB_ACTOR: 'owner', GITHUB_REPOSITORY_OWNER: 'owner',
          DEXIE_DISCUSSION_OPERATION: 'preview', DEXIE_DISCUSSION_CONFIRMATION: '', DEXIE_CLOUD_WRITE_KEY: 'SECRET_CREDENTIAL',
          RUNNER_TEMP: runner, GITHUB_RUN_ID: '1', GITHUB_RUN_ATTEMPT: '1', GITHUB_OUTPUT: join(root, 'output') },
      };
      const run = () => spawnSync(process.execPath, [fileURLToPath(new URL('./discussions.mjs', import.meta.url)), 'plan'], options);
      const result = run();
      expect(result.status).toBe(1);
      expect(result.stderr).toContain('UNEXPECTED_DISCUSSION_ROLE_BASELINE');
      expect(result.stderr).toContain('approved-existing:calendar-repeat');
      expect(result.stderr).not.toMatch(/SECRET_|privateTable/);
      expect(existsSync(join(dir, 'discussions-import.json'))).toBe(false);
      expect(readFileSync(join(dir, 'before-roles.json'), 'utf8')).toBe(roleFile);
      expect(readFileSync(join(dir, 'before-schema.json'), 'utf8')).toBe(schemaFile);
      // Successful Preview only stages the reviewed local payload; no cloud import is invoked.
      const validFile = JSON.stringify(installed()); writeFileSync(join(dir, 'before-roles.json'), validFile);
      const success = run();
      expect(success.status).toBe(0);
      expect(success.stdout).toContain('flex-repeat');
      expect(success.stdout + success.stderr).not.toMatch(/SECRET_|privateTable/);
      expect(readFileSync(join(dir, 'before-roles.json'), 'utf8')).toBe(validFile);
      expect(readFileSync(join(dir, 'before-schema.json'), 'utf8')).toBe(schemaFile);
      expect(JSON.parse(readFileSync(join(dir, 'discussions-import.json'), 'utf8'))).toEqual(plan(installed()).importPayload);
      const workflow = readFileSync(new URL('../../.github/workflows/dexie-discussions.yml', import.meta.url), 'utf8');
      expect(workflow).toContain("if: inputs.operation == 'apply' && steps.import_attempt.outputs.attempted == 'true'");
      expect(workflow).toContain("github.event_name == 'workflow_dispatch'");
      expect(workflow).toContain("github.ref == 'refs/heads/main'");
      expect(workflow).toContain('github.actor == github.repository_owner');
      expect(workflow).toContain('name: dexie-production');
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
});
