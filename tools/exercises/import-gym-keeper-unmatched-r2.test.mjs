import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildPlan, DESTINATION_PREFIX } from './import-gym-keeper-unmatched-r2.mjs';

// Intentionally use the actual committed source artifacts. These tests protect
// 112 exact identities; they do not depend on or change the 99 Data Sheet values.
function source() {
  const staging = JSON.parse(readFileSync('audit/visual/input/gymkeeper_unmatched_112_gymvisual_metadata.json', 'utf8'));
  const audit = JSON.parse(readFileSync('audit/visual/audit_execution_plan.json', 'utf8'));
  const sql = Array.from({ length: 7 }, (_, i) => {
    const n = String(i + 7).padStart(4, '0');
    const part = String(i + 1).padStart(2, '0');
    return readFileSync('migrations/' + n + '_gym_keeper_exercise_seed_' + part + '.sql', 'utf8');
  });
  return { staging, audit, sql };
}

describe('Gym Keeper 112 media-only R2 import', () => {
  it('maps exactly 112 absent APK IDs into an isolated private prefix', () => {
    const input = source();
    const plan = buildPlan(input.staging, input.audit, input.sql);
    expect(plan).toHaveLength(112);
    expect(new Set(plan.map(row => row.id)).size).toBe(112);
    expect(new Set(plan.map(row => row.targetR2)).size).toBe(112);
    expect(plan.every(row => row.targetR2.startsWith(DESTINATION_PREFIX))).toBe(true);
    expect(plan.every(row => row.sourceR2.startsWith('exercise-media/gym_keeper_apk/'))).toBe(true);
    expect(plan.every(row => row.sourceCdn.startsWith('https://47-1594.s.cdn13.com/img/gifs/180/'))).toBe(true);
    expect(plan.find(row => row.id === '0146')).toEqual({
      id: '0146',
      key: '01461305-Butt-Kicks-(female)_Cardio-FIX_180.gif',
      sourceR2: 'exercise-media/gym_keeper_apk/01461305-Butt-Kicks-(female)_Cardio-FIX_180.gif',
      sourceCdn: 'https://47-1594.s.cdn13.com/img/gifs/180/01461305-Butt-Kicks-(female)_Cardio-FIX_180.gif',
      targetR2: DESTINATION_PREFIX + '01461305-Butt-Kicks-(female)_Cardio-FIX_180.gif',
    });
  });

  it('rejects a missing, duplicated or unapproved source row', () => {
    const { staging, audit, sql } = source();
    expect(() => buildPlan({ ...staging, records: staging.records.slice(1) }, audit, sql))
      .toThrow('Unexpected import inputs');
    const duplicate = structuredClone(staging);
    duplicate.records[1] = structuredClone(duplicate.records[0]);
    expect(() => buildPlan(duplicate, audit, sql))
      .toThrow('Untrusted or inconsistent staging row');
    const injected = structuredClone(staging);
    injected.records[0].gym_keeper_apk_reference_key = '../secrets.gif';
    expect(() => buildPlan(injected, audit, sql))
      .toThrow('Untrusted or inconsistent staging row');
  });

  it('rejects a changed catalogue baseline or changed APK source name', () => {
    const { staging, audit, sql } = source();
    const invalidAudit = structuredClone(audit);
    invalidAudit.stages[0].exercise_ids[0] = '9999';
    // Changing the 1324 set must invalidate the 112-item difference.
    expect(() => buildPlan(staging, invalidAudit, sql)).toThrow();
    const invalidSql = [...sql];
    invalidSql[0] = invalidSql[0].replace(
      '01461305-Butt-Kicks-(female)_Cardio-FIX_180.gif',
      '01461305-Butt-Kicks-(female)_Unreviewed_180.gif',
    );
    expect(() => buildPlan(staging, audit, invalidSql))
      .toThrow('Untrusted or inconsistent staging row');
  });
});
