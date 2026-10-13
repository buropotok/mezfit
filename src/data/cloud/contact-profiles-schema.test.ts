import { describe, expect, it } from 'vitest';
import roles from '../../../cloud/roles.json';
import schema from '../../../cloud/schema-contact-profiles.json';
import { CLOUD_DATABASE_VERSION, CLOUD_DATABASE_STORES_V1, CLOUD_DATABASE_STORES_V2, CLOUD_DATABASE_STORES_V3 } from './database';

describe('contact profile cloud schema v2', () => {
  it('adds profile records without altering existing tables or database ownership', () => {
    for (const [table, declaration] of Object.entries(CLOUD_DATABASE_STORES_V1)) {
      expect(CLOUD_DATABASE_STORES_V2[table as keyof typeof CLOUD_DATABASE_STORES_V1]).toBe(declaration);
    }
    expect(CLOUD_DATABASE_STORES_V2.contactProfiles).toBe('id, realmId, userId');
    expect(schema.schema.contactProfiles).toBe(CLOUD_DATABASE_STORES_V2.contactProfiles);
  });

  it('upgrades to v3 without changing any v2 table definitions', () => {
    expect(CLOUD_DATABASE_VERSION).toBe(3);
    for (const [table, declaration] of Object.entries(CLOUD_DATABASE_STORES_V2)) {
      expect(CLOUD_DATABASE_STORES_V3[table as keyof typeof CLOUD_DATABASE_STORES_V2]).toBe(declaration);
    }
    expect(CLOUD_DATABASE_STORES_V3.publicExerciseDefinitions)
      .toBe('id, realmId, category, subcategory, movement_type, equipment');
    expect(CLOUD_DATABASE_STORES_V3.publicExerciseTaxonomy)
      .toBe('id, realmId, kind, parent_id');
    expect(CLOUD_DATABASE_STORES_V3.publicExerciseCatalogues)
      .toBe('id, realmId, sourceSha256');
    expect(Object.keys(CLOUD_DATABASE_STORES_V3).sort()).toEqual([
      ...Object.keys(CLOUD_DATABASE_STORES_V2),
      'publicExerciseDefinitions', 'publicExerciseTaxonomy', 'publicExerciseCatalogues',
    ].sort());
  });

  it('grants no ordinary client or coach writes to public catalogue tables', () => {
    for (const role of [roles.roles.coach, roles.roles.client]) {
      for (const table of ['publicExerciseDefinitions', 'publicExerciseTaxonomy', 'publicExerciseCatalogues']) {
        expect(JSON.stringify(role.permissions)).not.toContain(table);
      }
    }
  });

  it('grants no ordinary client or coach writes to administrative contact identity projections', () => {
    expect(JSON.stringify(roles.roles.coach.permissions)).not.toContain('contactProfiles');
    expect(JSON.stringify(roles.roles.client.permissions)).not.toContain('contactProfiles');
  });
});
