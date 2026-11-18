import { describe, expect, it } from 'vitest';
import { authorize, missingRows, schemaPlan, SCHEMA } from './fitnessprogramer-operator.mjs';

const ownerRun = {
  GITHUB_REPOSITORY: 'buropotok/mezfit',
  GITHUB_EVENT_NAME: 'workflow_dispatch',
  GITHUB_REF: 'refs/heads/main',
  GITHUB_ACTOR: 'buropotok',
  GITHUB_REPOSITORY_OWNER: 'buropotok',
};
const manifest = { schema: SCHEMA };
const roles = { roles: {} };

describe('FitnessProgramer protected publication', () => {
  it('accepts a manual owner preview and requires exact confirmation to apply', () => {
    expect(() => authorize({ ...ownerRun, BASE_2_OPERATION: 'preview' })).not.toThrow();
    expect(() => authorize({ ...ownerRun, BASE_2_OPERATION: 'apply' })).toThrow('INVALID_FITNESSPROGRAMER_CONFIRMATION');
    expect(() => authorize({ ...ownerRun, BASE_2_OPERATION: 'apply',
      BASE_2_CONFIRMATION: 'PUBLISH_FITNESSPROGRAMER_BASE_2_V1' })).not.toThrow();
  });

  it('rejects PRs, other repositories, and dispatches from non-owners', () => {
    for (const override of [{ GITHUB_REF: 'refs/pull/1/merge' },
      { GITHUB_REPOSITORY: 'someone/mezfit' }, { GITHUB_ACTOR: 'someone' }]) {
      expect(() => authorize({ ...ownerRun, BASE_2_OPERATION: 'preview', ...override }))
        .toThrow('UNAUTHORIZED_FITNESSPROGRAMER_DISPATCH');
    }
  });

  it('plans only missing tables with the approved primary keys', () => {
    const { publicFitnessProgramerExercises: existing, ...missing } = SCHEMA;
    expect(schemaPlan(manifest, { schema: { publicFitnessProgramerExercises: existing,
      publicExerciseDefinitions: 'id' } }, roles)).toEqual({ schema: missing });
    expect(() => schemaPlan(manifest, { schema: { publicFitnessProgramerExercises: '@id' } }, roles))
      .toThrow('CONFLICTING_FITNESSPROGRAMER_TABLE');
    expect(() => schemaPlan({ schema: { ...SCHEMA, unrelated: 'id' } }, { schema: {} }, roles))
      .toThrow('INVALID_FITNESSPROGRAMER_SCHEMA');
  });

  it('resumes only missing rows and rejects conflicting or duplicate rows', () => {
    const existing = { id: 'fitnessprogramer:squat', release: 'one' };
    const pending = { id: 'fitnessprogramer:plank', release: 'one' };
    expect(missingRows([{ ...existing, serverMetadata: 1 }], [existing, pending], 'CONFLICT'))
      .toEqual([pending]);
    expect(() => missingRows([{ ...existing, release: 'two' }], [existing], 'CONFLICT')).toThrow('CONFLICT');
    expect(() => missingRows([existing, existing], [existing], 'CONFLICT')).toThrow('CONFLICT');
  });
});
