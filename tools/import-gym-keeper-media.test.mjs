import { describe, expect, it } from 'vitest';
import { extractReferenceKeysFromSeedSql, loadReferenceKeys } from './import-gym-keeper-media.mjs';

describe('Gym Keeper media import catalogue', () => {
  it('keeps complete 334-item APK media coverage across migrations', async () => {
    const keys = await loadReferenceKeys();
    expect(keys).toHaveLength(334);
    expect(keys).toContain('16281305-EZ-Barbell-Spider-Curl_Upper-Arms_180.gif');
    expect(keys).toContain('12411305-Bird-Dog-male_Back_180.gif');
  });

  it('parses SQL-escaped reference keys without truncation', () => {
    const sql = "('global','x','weight_reps','arms','barbell','gym_keeper_apk','example-it''s-curl_180.gif',1);";
    expect(extractReferenceKeysFromSeedSql(sql)).toEqual(["example-it's-curl_180.gif"]);
  });
});
