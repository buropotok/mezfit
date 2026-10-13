import { describe, expect, it } from 'vitest';
import { diagnosePublicCatalogue, renderPublicCatalogueReport } from './report-public-catalogue.mjs';

const expectedSha = '5ce3e6b15117e115a1e10ac31573eb85eea6bf284a72971e5ca1ee02572aa40c';
const fullSchema = {
  schema: {
    trainingPlans: '@id',
    publicExerciseDefinitions: 'id, realmId',
    publicExerciseTaxonomy: 'id, realmId',
    publicExerciseCatalogues: 'id, realmId',
  },
};
const roles = { roles: { coach: { permissions: { manage: ['trainingPlans'] } },
  client: { permissions: { update: { sessionSetFacts: ['actualReps'] } } } } };

describe('Dexie public catalogue operator diagnostics', () => {
  it('reports absent tables and activation without treating an empty realm as published', () => {
    const report = diagnosePublicCatalogue({ schema: { trainingPlans: '@id' } }, roles, { data: {} });
    expect(report.tables.publicExerciseDefinitions).toEqual({ schemaPresent: false, records: 0 });
    expect(report.tables.publicExerciseTaxonomy.records).toBe(0);
    expect(report.manifestPresent).toBe(false);
    expect(report.expectedManifest).toBe(false);
    expect(report.recordCountsMatch).toBe(false);
    expect(renderPublicCatalogueReport(report)).toContain('Publication manifest: missing');
  });

  it('recognizes matching counts and manifest but does not claim content verification', () => {
    const rows = Object.fromEntries(Array.from({ length: 1324 }, (_, i) => [String(i).padStart(4, '0'), {}]));
    const nodes = Object.fromEntries(Array.from({ length: 69 }, (_, i) => [String(i), {}]));
    const data = { data: { 'rlm-public': {
      publicExerciseDefinitions: rows,
      publicExerciseTaxonomy: nodes,
      publicExerciseCatalogues: { 'mezfit:exercise-catalogue': {
        realmId: 'rlm-public', owner: null, schemaVersion: '2.0.0',
        sourceSha256: expectedSha, exerciseCount: 1324, taxonomyCount: 69,
      } },
    } } };
    const report = diagnosePublicCatalogue(fullSchema, roles, data);
    expect(report.recordCountsMatch).toBe(true);
    expect(report.expectedManifest).toBe(true);
    expect(report.actorWriteReferences).toEqual([]);
    expect(renderPublicCatalogueReport(report)).toContain('Not a permission audit or content verification.');
  });

  it('flags public write grants, wildcard access and unexpected schema keys', () => {
    const untrustedRoles = { roles: {
      coach: { permissions: { manage: ['publicExerciseDefinitions'] } },
      client: { permissions: { manage: ['*'] } },
    } };
    const schema = { schema: { ...fullSchema.schema, publicExerciseTaxonomy: '@id' } };
    const report = diagnosePublicCatalogue(schema, untrustedRoles, { data: {} });
    expect(report.actorWriteReferences).toEqual(['coach', 'client']);
    expect(report.tables.publicExerciseTaxonomy.schemaPresent).toBe(false);
  });

  it('rejects malformed schema, role, realm and table exports rather than guessing', () => {
    expect(() => diagnosePublicCatalogue({ schema: [] }, roles, {})).toThrow('schema must be an object');
    expect(() => diagnosePublicCatalogue(fullSchema, { roles: null }, {})).toThrow('roles must be an object');
    expect(() => diagnosePublicCatalogue(fullSchema, roles, { data: { 'rlm-public': [] } }))
      .toThrow('rlm-public must be an object');
    expect(() => diagnosePublicCatalogue(fullSchema, roles, { data: { 'rlm-public': {
      publicExerciseDefinitions: null,
    } } })).toThrow('public table publicExerciseDefinitions must be an object');
  });
});
