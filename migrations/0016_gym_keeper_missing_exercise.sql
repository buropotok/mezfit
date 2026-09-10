PRAGMA foreign_keys = ON;

-- Repair the one APK catalogue record accidentally omitted from the original 0007-0013 seed split.
-- reference_order 243 is present in the canonical 334-record APK sequence between orders 242 and 244.
INSERT OR IGNORE INTO exercise_definition (
  scope,
  name,
  tracking_type,
  category_code,
  equipment_code,
  reference_source,
  reference_key,
  reference_media_url,
  reference_order
) VALUES (
  'global',
  'Паучьи сгибания · штанга',
  'weight_reps',
  'arms',
  'barbell',
  'gym_keeper_apk',
  '16281305-EZ-Barbell-Spider-Curl_Upper-Arms_180.gif',
  'https://47-1594.s.cdn13.com/img/gifs/180/16281305-EZ-Barbell-Spider-Curl_Upper-Arms_180.gif',
  243
);
