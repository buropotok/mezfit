import { describe, expect, it } from 'vitest';
import {
  authorizeCategoryArtworkOperation, planCategoryArtworkSchema,
  verifyCategoryArtworkSchema, CONFIRMATION,
} from './category-artwork-operator.mjs';

const manifest = { schema: { publicExerciseCategoryArtworks: 'id' } };
const schema = { schema: { publicExerciseDefinitions: 'id' }, sealed: false };
const roles = { roles: { coach: { permissions: {} }, client: { permissions: {} } } };

describe('protected Dexie public category artwork schema operator', () => {
  it('adds only one table and never touches roles or old tables', () => {
    expect(planCategoryArtworkSchema(manifest, schema, roles)).toEqual({
      missing: { publicExerciseCategoryArtworks: 'id' }, count: 1,
    });
    expect(() => verifyCategoryArtworkSchema(manifest, schema, roles,
      { ...schema, schema: { ...schema.schema, publicExerciseCategoryArtworks: 'id' } }, roles)).not.toThrow();
    expect(() => verifyCategoryArtworkSchema(manifest, schema, roles,
      { ...schema, schema: { ...schema.schema, publicExerciseCategoryArtworks: 'id' } },
      { roles: { coach: { permissions: { add: ['publicExerciseCategoryArtworks'] } } } })).toThrow('CATEGORY_ARTWORK_ROLES_CHANGED');
  });

  it('rejects conflicting schema and unauthorized manual dispatch', () => {
    expect(() => planCategoryArtworkSchema(manifest, {
      ...schema, schema: { ...schema.schema, publicExerciseCategoryArtworks: '@id' },
    }, roles)).toThrow('CONFLICTING_CATEGORY_ARTWORK_TABLE');
    const approved = {
      GITHUB_EVENT_NAME: 'workflow_dispatch', GITHUB_REF: 'refs/heads/main',
      GITHUB_ACTOR: 'owner', GITHUB_REPOSITORY_OWNER: 'owner',
      CATEGORY_ARTWORK_OPERATION: 'apply', CATEGORY_ARTWORK_CONFIRMATION: CONFIRMATION,
    };
    expect(() => authorizeCategoryArtworkOperation(approved)).not.toThrow();
    expect(() => authorizeCategoryArtworkOperation({ ...approved, GITHUB_ACTOR: 'visitor' })).toThrow();
    expect(() => authorizeCategoryArtworkOperation({ ...approved, GITHUB_REF: 'refs/heads/feature' })).toThrow();
    expect(() => authorizeCategoryArtworkOperation({ ...approved, CATEGORY_ARTWORK_CONFIRMATION: '' })).toThrow();
  });
});
