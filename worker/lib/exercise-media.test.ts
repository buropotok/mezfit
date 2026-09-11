import { describe, expect, it } from 'vitest';
import { exerciseMediaPublicUrl, exerciseMediaR2Key, handleExerciseMediaRoute } from './exercise-media';

const datasetKey = '0001-2gPfomN.gif';

describe('canonical exercise dataset media mapping', () => {
  it('uses one stable R2 object key per dataset media key', () => {
    expect(exerciseMediaR2Key('github_exercises_dataset', datasetKey))
      .toBe(`exercise-media/github_exercises_dataset/${datasetKey}`);
  });

  it('exposes media only for the canonical dataset source', () => {
    expect(exerciseMediaPublicUrl('github_exercises_dataset', datasetKey))
      .toBe(`/api/exercise-media/gym_keeper_apk/${datasetKey}`);
    expect(exerciseMediaPublicUrl('gym_keeper_apk', datasetKey)).toBeNull();
    expect(exerciseMediaPublicUrl(null, datasetKey)).toBeNull();
    expect(exerciseMediaPublicUrl('coach', datasetKey)).toBeNull();
  });

  it('rejects dataset POSTs without a verified GitHub Actions OIDC token', async () => {
    const request = new Request(`https://mezfit.test/api/exercise-media/gym_keeper_apk/${datasetKey}`, { method: 'POST' });
    const response = await handleExerciseMediaRoute(request, {} as D1Database, {} as R2Bucket, datasetKey);
    expect(response.status).toBe(403);
  });
});
