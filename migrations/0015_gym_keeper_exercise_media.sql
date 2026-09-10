PRAGMA foreign_keys = ON;

-- #34: deterministic source mapping for the approved Gym Keeper exercise GIF library.
-- The stable APK reference_key remains the identity used by D1, R2 and the UI.
UPDATE exercise_definition
SET reference_media_url = 'https://47-1594.s.cdn13.com/img/gifs/180/' || reference_key
WHERE reference_source = 'gym_keeper_apk'
  AND reference_key IS NOT NULL
  AND (reference_media_url IS NULL OR reference_media_url = '');

CREATE INDEX IF NOT EXISTS idx_exercise_reference_media
  ON exercise_definition(reference_source, reference_key, reference_media_url);
