import { describe, expect, it } from 'vitest';
import { executeRemediation, remediationPlan } from './remediate-public-catalogue.mjs';

const SHA = '5ce3e6b15117e115a1e10ac31573eb85eea6bf284a72971e5ca1ee02572aa40c';
const DIGEST = 'a'.repeat(64);
const FIELDS = {
  '3637': ['instructions.ru', 'instructions.en', 'instruction_steps.ru', 'instruction_steps.en', 'name_ru', 'name_en', 'name'],
  '3235': ['instructions.ru', 'instructions.en', 'instruction_steps.ru', 'instruction_steps.en'],
  '3291': ['instructions.ru', 'instructions.en', 'instruction_steps.ru', 'instruction_steps.en'],
  '3292': ['instructions.ru', 'instructions.en', 'instruction_steps.ru', 'instruction_steps.en', 'subcategory', 'subcategory_ru'],
  '3315': ['instructions.ru', 'instructions.en', 'instruction_steps.ru', 'instruction_steps.en'],
  '3638': ['instructions.ru', 'instructions.en', 'instruction_steps.ru', 'instruction_steps.en', 'name_ru', 'name_en', 'name'],
};
const SIX = Object.keys(FIELDS);

function at(row, path) { return path.split('.').reduce((node, key) => node[key], row); }
function fixture() {
  const ids = [...Array.from({ length: 1318 }, (_, i) => String(i + 1).padStart(4, '0')), ...SIX];
  const taxonomy = Object.fromEntries(Array.from({ length: 69 }, (_, i) =>
    ['tx' + i, { kind: 'muscle', parent_id: null, category_ru: 'Группа',
      subcategory_ru: 'Мышца', anatomical_description_ru: 'Описание' }]));
  const exercises = ids.map((id, index) => ({
    id, name: 'Название ' + id, name_ru: 'Название ' + id, name_en: 'Name ' + id,
    category: 'full_body', subcategory: 'spinal_erectors', subcategory_ru: 'Разгибатели позвоночника',
    movement_type: 'strength', muscles: { primary: [], secondary: [], stabilizers: [], emphasis: [] },
    mobility_targets: [], equipment: 'bodyweight', body_part: 'body', target: 'body',
    muscle_group: 'body', secondary_muscles: [], media_id: 'media',
    image: 'images/' + id + '-media.jpg', gif_url: 'videos/' + id + '-media.gif',
    attribution: 'test data', created_at: '2026-01-01',
    instructions: { ru: 'Старая техника', en: 'Old technique' },
    instruction_steps: { ru: ['Старая техника'], en: ['Old technique'] },
    source_consistency_issue: index < 9 ? 'source defect' : null,
    anatomy_evidence: { classification_family: 'gymnastics', basis: 'reference', external_individual_match: false },
  }));
  const source = {
    schema_version: '2.0.0', catalogue: 'mezfit.exercise_catalog.ru_anatomy',
    metadata: { exercise_count: 1324, source_id_preserved: true, source_consistency_issues_count: 9 },
    exercises, taxonomy, subcategory_labels_ru: {
      spinal_erectors: 'Разгибатели позвоночника', upper_back: 'Верх спины',
    }, movement_family_references: {},
  };
  const changes = [];
  const entries = SIX.map(id => {
    const row = exercises.find(x => x.id === id);
    const field_replacements = Object.fromEntries(FIELDS[id].map(field => {
      const proposed_value = field === 'instructions.ru' ? 'Новая техника'
        : field === 'instructions.en' ? 'New technique'
          : field === 'instruction_steps.ru' ? ['Новая техника']
            : field === 'instruction_steps.en' ? ['New technique']
              : field === 'subcategory' ? 'upper_back'
                : field === 'subcategory_ru' ? 'Верх спины'
                  : field === 'name_en' ? 'Updated name ' + id : 'Обновлённое название ' + id;
      changes.push({ id, field, proposed_value });
      return [field, { expected_current: at(row, field), proposed_value }];
    }));
    return { id, original_name_ru: row.name_ru, original_name_en: row.name_en,
      proposed_name_ru: field_replacements.name_ru?.proposed_value ?? row.name_ru,
      proposed_name_en: field_replacements.name_en?.proposed_value ?? row.name_en,
      gif_url: row.gif_url, audit_status: 'confirmed_mismatch', audit_priority: 'P0',
      approval_state: 'pending', applied: false, field_replacements };
  });
  const proposal = {
    batch_id: 'REM-01', source_catalogue_sha256: SHA, target: 'publicExerciseDefinitions',
    exercise_count: 6, expected_exercise_ids: SIX, approval_state: 'editorial_review_pending',
    automatic_application_permitted: false, exercises: entries,
  };
  const manifest = { id: 'mezfit:exercise-catalogue', realmId: 'rlm-public', owner: null,
    sourceSha256: SHA, schemaVersion: '2.0.0', exerciseCount: 1324, taxonomyCount: 69,
    publishedAt: '2026-10-01T12:00:00.000Z', trackingSchemaVersion: '2.1.0',
    trackingReleaseSha256: 'ee0f313fa15dd8a35a7e6cc558ccd6012810128948e8c8a9e6b5381bf6449c66' };
  const current = {
    publicExerciseDefinitions: exercises.map(row => ({
      ...structuredClone(row), realmId: 'rlm-public', owner: null, sourceSha256: SHA, tracking_type: 'weight_reps',
    })),
    publicExerciseTaxonomy: Object.entries(taxonomy).map(([id, value]) => ({
      id, ...value, realmId: 'rlm-public', owner: null, sourceSha256: SHA,
    })),
    publicExerciseCatalogues: [manifest],
  };
  return { source, proposal, current, changes };
}
function fakeSession(current, { corrupt = false, failManifest = false } = {}) {
  const state = structuredClone(current), writes = [];
  const session = {
    async list(name) { return structuredClone(state[name]); },
    async put(name, rows) {
      writes.push({ name, rows: structuredClone(rows) });
      if (failManifest && name === 'publicExerciseCatalogues') throw new Error('simulated failure');
      for (const row of rows) {
        const i = state[name].findIndex(r => r.id === row.id);
        if (i < 0) throw new Error('illegal new row');
        state[name][i] = structuredClone(row);
      }
      if (corrupt && name === 'publicExerciseDefinitions') state[name][0].name = 'tampered';
    },
  };
  return { state, writes, session };
}
describe('REM-01 protected catalogue correction operator', () => {
  it('limits the draft to six exact IDs and 32 reviewed field changes', () => {
    const f = fixture();
    const plan = remediationPlan(f.current, f.source, f.proposal, DIGEST);
    expect(f.changes).toHaveLength(32);
    expect(plan.updates.map(row => row.id)).toEqual(SIX);
    expect(plan.approved).toBe(false);
    const original = f.current.publicExerciseDefinitions.find(row => row.id === '3637');
    const replacement = plan.updates[0];
    expect(original).not.toBe(replacement);
    expect(replacement.tracking_type).toBe('weight_reps');
    expect(replacement.media_id).toBe(original.media_id);
  });
  it('rejects out-of-scope fields, forged old values, unknown ids and foreign realm', () => {
    let f = fixture();
    f.proposal.exercises[0].field_replacements.equipment = { expected_current: 'bodyweight', proposed_value: 'rings' };
    expect(() => remediationPlan(f.current, f.source, f.proposal, DIGEST)).toThrow(/allowlist/);
    f = fixture();
    f.proposal.exercises[0].field_replacements.name_ru.expected_current = 'forged';
    expect(() => remediationPlan(f.current, f.source, f.proposal, DIGEST)).toThrow(/ungrounded/);
    f = fixture();
    f.current.publicExerciseDefinitions[0].realmId = 'private-realm';
    expect(() => remediationPlan(f.current, f.source, f.proposal, DIGEST)).toThrow(/Unexpected public row/);
    f = fixture();
    f.current.publicExerciseDefinitions[0].id = '9999';
    expect(() => remediationPlan(f.current, f.source, f.proposal, DIGEST)).toThrow(/Unknown public exercise ID/);
  });
  it('does not allow publication with pending editorial review or without a private R2 backup', async () => {
    const f = fixture(), db = fakeSession(f.current);
    await expect(executeRemediation({ session: db.session, source: f.source, patch: f.proposal,
      patchSha256: DIGEST, backupApproved: true })).rejects.toThrow(/approved editorial/);
    f.proposal.approval_state = 'approved';
    f.proposal.exercises.forEach(item => { item.approval_state = 'approved'; });
    await expect(executeRemediation({ session: db.session, source: f.source, patch: f.proposal,
      patchSha256: DIGEST, backupApproved: false })).rejects.toThrow(/private R2 backup/);
    expect(db.writes).toHaveLength(0);
  });
  it('writes only six definitions, then verifies all records and activates marker last; replay is idempotent', async () => {
    const f = fixture(), db = fakeSession(f.current);
    f.proposal.approval_state = 'approved';
    f.proposal.exercises.forEach(item => { item.approval_state = 'approved'; });
    const outcome = await executeRemediation({ session: db.session, source: f.source,
      patch: f.proposal, patchSha256: DIGEST, backupApproved: true });
    expect(outcome).toMatchObject({ status: 'published', updated: 6, verifiedExercises: 1324 });
    expect(db.writes.map(w => w.name)).toEqual(['publicExerciseDefinitions', 'publicExerciseCatalogues']);
    expect(db.writes[0].rows.map(row => row.id)).toEqual(SIX);
    expect(db.state.publicExerciseDefinitions).toHaveLength(1324);
    expect(db.state.publicExerciseTaxonomy).toEqual(f.current.publicExerciseTaxonomy);
    expect(db.state.publicExerciseDefinitions[100]).toEqual(f.current.publicExerciseDefinitions[100]);
    expect(db.state.publicExerciseCatalogues[0].remediationReleaseSha256).toBe(DIGEST);
    const replay = await executeRemediation({ session: db.session, source: f.source,
      patch: f.proposal, patchSha256: DIGEST, backupApproved: true });
    expect(replay).toMatchObject({ status: 'already-active', updated: 0 });
    expect(db.writes).toHaveLength(2);
  });
  it('does not activate manifest after partial failure or readback mutation', async () => {
    const f = fixture(), db = fakeSession(f.current, { corrupt: true });
    f.proposal.approval_state = 'approved';
    f.proposal.exercises.forEach(item => { item.approval_state = 'approved'; });
    await expect(executeRemediation({ session: db.session, source: f.source,
      patch: f.proposal, patchSha256: DIGEST, backupApproved: true })).rejects.toThrow(/readback/);
    expect(db.writes.map(w => w.name)).toEqual(['publicExerciseDefinitions']);
    const clean = fakeSession(f.current, { failManifest: true });
    await expect(executeRemediation({ session: clean.session, source: f.source,
      patch: f.proposal, patchSha256: DIGEST, backupApproved: true })).rejects.toThrow(/simulated failure/);
    expect(clean.state.publicExerciseCatalogues[0].remediationReleaseId).toBeUndefined();
    const recovered = fakeSession(clean.state);
    const result = await executeRemediation({ session: recovered.session, source: f.source,
      patch: f.proposal, patchSha256: DIGEST, backupApproved: true });
    expect(result).toMatchObject({ status: 'published', updated: 0 });
  });
});
