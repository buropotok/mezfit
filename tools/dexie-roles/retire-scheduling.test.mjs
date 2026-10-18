import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  assertApprovedManifest, assertExactImportPayload, assertUnchangedBeforeApply, planSchedulingAcl,
  validateAclDispatch, verifySchedulingAcl,
} from './retire-scheduling.mjs';

const manifest = JSON.parse(readFileSync(new URL('../../cloud/roles.json', import.meta.url), 'utf8'));
const workflow = readFileSync(new URL('../../.github/workflows/dexie-retire-scheduling-acl.yml', import.meta.url), 'utf8');
const target = structuredClone(manifest.roles);
const current = structuredClone(target);
current.coach.permissions.add = ['workoutScheduleRequests'];
current.client.permissions.add = ['workoutScheduleRequests'];
current.coach.description = 'Can author assigned PLAN, request scheduling, and edit set FACT; session lifecycle stays privileged';
current.client.description = 'Can read assigned PLAN, request scheduling, and edit set FACT; session lifecycle stays privileged';

const schema = {
  sealed: true, schema: { trainingPlans: '@id', workoutScheduleRequests: 'id', workoutOccurrences: '@id' },
};
const remote = extra => ({
  roles: { coach: structuredClone(current.coach), client: structuredClone(current.client), ...extra },
});
const trustedEnv = {
  GITHUB_EVENT_NAME: 'workflow_dispatch',
  GITHUB_REF: 'refs/heads/main',
  GITHUB_ACTOR: 'buropotok',
  GITHUB_REPOSITORY_OWNER: 'buropotok',
  DEXIE_ACL_OPERATION: 'preview',
  DEXIE_ACL_CONFIRMATION: '',
};

describe('protected retirement of scheduling role grants', () => {
  it('cannot trigger privileged ACL mutation on push/PR or outside protected owner/main dispatch', () => {
    expect(workflow).toMatch(/^on:\n  workflow_dispatch:/m);
    expect(workflow).not.toMatch(/^\s+(?:push|pull_request|schedule):/m);
    expect(workflow).toContain("github.ref == 'refs/heads/main'");
    expect(workflow).toContain('github.actor == github.repository_owner');
    expect(workflow).toContain('name: dexie-production');
    expect(workflow).toContain('secrets.DEXIE_CLOUD_WRITE_KEY');
    expect(workflow).toContain('group: dexie-public-catalogue-publishing');
    expect(workflow).toContain('dexie-cloud import roles-only-import.json');
    expect(workflow).toContain('node tools/dexie-roles/retire-scheduling.mjs recheck');
    expect(workflow).toContain('node tools/dexie-roles/retire-scheduling.mjs verify');
    expect(workflow).not.toContain('dexie-cloud import cloud/roles.json');
  });

  it('reads back and verifies ACL even if an attempted cloud import reports failure', () => {
    const marker = 'id: import_attempt';
    const importCommand = 'dexie-cloud import roles-only-import.json';
    const readback = '- name: Export schema and roles after any ACL import attempt';
    const verify = '- name: Verify exact ACL and untouched cloud configuration';
    expect(workflow.indexOf(marker)).toBeGreaterThan(-1);
    expect(workflow.indexOf(marker)).toBeLessThan(workflow.indexOf(importCommand));
    expect(workflow.indexOf(importCommand)).toBeLessThan(workflow.indexOf(readback));
    expect(workflow.indexOf(readback)).toBeLessThan(workflow.indexOf(verify));
    expect(workflow).toContain('run: echo "attempted=true" >> "$GITHUB_OUTPUT"');

    const afterReadback = workflow.slice(workflow.indexOf(readback));
    const readbackIf = afterReadback.split('\n').find(line => line.trim().startsWith('if:'));
    const verifyIf = workflow.slice(workflow.indexOf(verify)).split('\n')
      .find(line => line.trim().startsWith('if:'));
    for (const condition of [readbackIf, verifyIf]) {
      expect(condition).toContain('!cancelled()');
      expect(condition).toContain("steps.import_attempt.outputs.attempted == 'true'");
      expect(condition).toContain("steps.plan.outputs.change_count == '0'");
      expect(condition).not.toContain('success()');
    }
    expect(workflow.slice(workflow.indexOf(marker), workflow.indexOf(importCommand)))
      .toContain("steps.plan.outputs.change_count != '0'");
  });

  it('allows exactly the reviewed current-role manifest, not generalized role changes', () => {
    expect(assertApprovedManifest(manifest)).toEqual(target);
    expect(() => assertApprovedManifest({ roles: current }))
      .toThrow('INVALID_SCHEDULING_ROLE_MANIFEST');
    for (const invalid of [
      { roles: { ...target, admin: { permissions: { manage: '*' } } } },
      { roles: { ...target, client: { ...target.client, permissions: { manage: '*' } } } },
      { roles: { ...target, coach: { ...target.coach, permissions: {
        ...target.coach.permissions, manage: [...target.coach.permissions.manage, 'workoutOccurrences'],
      } } } },
      { roles: { ...target, client: { ...target.client, permissions: {
        ...target.client.permissions, add: ['workoutScheduleRequests', 'sessionExercises'],
      } } } },
      { ...manifest, data: { 'rlm-public': {} } },
      { roles: { coach: target.coach } },
    ]) expect(() => assertApprovedManifest(invalid)).toThrow('INVALID_SCHEDULING_ROLE_MANIFEST');
  });

  it('plans only Coach/Client role updates, preserving other global role entries', () => {
    const before = remote({ observer: { permissions: {}, displayName: 'Observer' } });
    const snapshot = structuredClone(before);
    const result = planSchedulingAcl(manifest, schema, before);
    expect(result.changedNames).toEqual(['coach', 'client']);
    expect(result.importPayload).toEqual({ roles: target });
    expect(Object.keys(result.importPayload)).toEqual(['roles']);
    expect(before).toEqual(snapshot);
    const after = { roles: { ...snapshot.roles, ...result.importPayload.roles } };
    expect(() => verifySchedulingAcl(manifest, schema, before, schema, after)).not.toThrow();
    expect(after.roles.observer).toEqual(before.roles.observer);
  });

  it('supports a partially finished operation and an idempotent no-op', () => {
    const partiallyApplied = remote();
    partiallyApplied.roles.coach = structuredClone(target.coach);
    const step = planSchedulingAcl(manifest, schema, partiallyApplied);
    expect(step.changedNames).toEqual(['client']);
    expect(step.importPayload).toEqual({ roles: { client: target.client } });
    const finished = { roles: { ...partiallyApplied.roles, client: structuredClone(target.client) } };
    expect(() => verifySchedulingAcl(manifest, schema, partiallyApplied, schema, finished)).not.toThrow();
    expect(planSchedulingAcl(manifest, schema, finished)).toEqual({
      importPayload: { roles: {} }, changedNames: [],
    });
  });

  it('fails closed on permissions drift, injected data and wrong schema', () => {
    for (const mutation of [
      { permissions: { ...current.client.permissions, manage: ['workoutOccurrences'] } },
      { permissions: { ...current.client.permissions, add: ['workoutSessions'] } },
      { permissions: { update: { sessionSetFacts: ['owner'] } } },
      { description: 'Unapproved text' },
    ]) {
      const changed = remote();
      changed.roles.client = { ...changed.roles.client, ...mutation };
      expect(() => planSchedulingAcl(manifest, schema, changed))
        .toThrow('UNEXPECTED_INSTALLED_SCHEDULING_ROLE');
    }
    expect(() => planSchedulingAcl(manifest, { schema: null }, remote()))
      .toThrow('INVALID_SCHEDULING_CLOUD_STRUCTURE');
  });

  it('rejects payload tampering and role/import expansion before cloud writes', () => {
    const planned = planSchedulingAcl(manifest, schema, remote()).importPayload;
    expect(() => assertExactImportPayload(planned, structuredClone(planned))).not.toThrow();
    for (const invalid of [
      { ...planned, schema: { workoutOccurrences: 'id' } },
      { ...planned, data: { 'rlm-public': {} } },
      { roles: { ...planned.roles, other: { permissions: { manage: '*' } } } },
      { roles: { ...planned.roles, client: { ...target.client, permissions: { manage: '*' } } } },
      { roles: { coach: target.coach } },
    ]) expect(() => assertExactImportPayload(planned, invalid))
      .toThrow('ACL_IMPORT_PAYLOAD_CHANGED');
  });

  it('refuses to write from a stale preview or modified import payload', () => {
    const original = remote();
    expect(() => assertUnchangedBeforeApply(schema, original,
      structuredClone(schema), structuredClone(original))).not.toThrow();
    expect(() => assertUnchangedBeforeApply(schema, original,
      { ...schema, sealed: false }, original))
      .toThrow('CLOUD_CONFIGURATION_CHANGED_SINCE_PREVIEW');
    const changed = remote();
    changed.roles.coach.description = 'Other operator edited this';
    expect(() => assertUnchangedBeforeApply(schema, original, schema, changed))
      .toThrow('CLOUD_CONFIGURATION_CHANGED_SINCE_PREVIEW');
  });

  it('detects unauthorized changes after role import, including missing or new roles', () => {
    const before = remote({ observer: { permissions: {} } });
    const approved = { roles: { ...before.roles, ...target } };
    for (const changed of [
      { roles: { ...approved.roles, observer: { permissions: { manage: '*' } } } },
      { roles: { ...approved.roles, extra: { permissions: {} } } },
      { roles: { coach: target.coach, client: target.client } },
      { roles: { ...approved.roles, client: current.client } },
    ]) {
      expect(() => verifySchedulingAcl(manifest, schema, before, schema, changed)).toThrow();
    }
    expect(() => verifySchedulingAcl(manifest, schema, before,
      { ...schema, schema: { ...schema.schema, workoutOccurrences: 'id' } }, approved))
      .toThrow('UNEXPECTED_CLOUD_CONFIGURATION_CHANGE');
  });

  it('requires owner-only manual main dispatch and exact apply confirmation', () => {
    expect(() => validateAclDispatch(trustedEnv)).not.toThrow();
    expect(() => validateAclDispatch({
      ...trustedEnv,
      DEXIE_ACL_OPERATION: 'apply',
      DEXIE_ACL_CONFIRMATION: 'REVOKE_SCHEDULING_COACH_CLIENT_ACL',
    })).not.toThrow();
    for (const invalid of [
      { GITHUB_REF: 'refs/heads/feature' },
      { GITHUB_ACTOR: 'collaborator' },
      { GITHUB_EVENT_NAME: 'push' },
      { DEXIE_ACL_OPERATION: 'delete' },
      { DEXIE_ACL_OPERATION: 'apply' },
      { DEXIE_ACL_CONFIRMATION: 'REVOKE_SCHEDULING_COACH_CLIENT_ACL ' },
    ]) {
      expect(() => validateAclDispatch({ ...trustedEnv, ...invalid })).toThrow();
    }
  });
});
