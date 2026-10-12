import { describe, expect, it } from 'vitest';
import roles from '../../../cloud/roles.json';
import schema from '../../../cloud/schema-contact-profiles.json';
import { CLOUD_DATABASE_VERSION, CLOUD_DATABASE_STORES_V1, CLOUD_DATABASE_STORES_V2 } from './database';

describe('contact profile cloud schema v2', () => {
  it('adds profile records without altering existing tables or database ownership', () => {
    expect(CLOUD_DATABASE_VERSION).toBe(2);
    for (const [table, declaration] of Object.entries(CLOUD_DATABASE_STORES_V1)) {
      expect(CLOUD_DATABASE_STORES_V2[table as keyof typeof CLOUD_DATABASE_STORES_V1]).toBe(declaration);
    }
    expect(CLOUD_DATABASE_STORES_V2.contactProfiles).toBe('id, realmId, userId');
    expect(schema.schema.contactProfiles).toBe(CLOUD_DATABASE_STORES_V2.contactProfiles);
  });

  it('grants no ordinary client or coach writes to administrative contact identity projections', () => {
    expect(JSON.stringify(roles.roles.coach.permissions)).not.toContain('contactProfiles');
    expect(JSON.stringify(roles.roles.client.permissions)).not.toContain('contactProfiles');
  });
});
