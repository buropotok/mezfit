/** A versioned, unguessable R2 media reference carried by personal exercise snapshots. */
const PERSONAL_MEDIA_URL = /^\/api\/exercise-media\/personal\/[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}\?v=[a-f0-9]{64}$/;

export function isPersonalExerciseMediaUrl(url: unknown): url is string {
  return typeof url === 'string' && PERSONAL_MEDIA_URL.test(url);
}
