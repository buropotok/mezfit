import { describe, expect, it } from 'vitest';
import { exerciseMediaPublicUrl, exerciseMediaR2Key, handleExerciseMediaRoute } from './exercise-media';

const datasetId = '0001';

describe('canonical exercise dataset media mapping', () => {
  it('uses the stable dataset id for the R2 object key', () => {
    expect(exerciseMediaR2Key('github_exercises_dataset', datasetId))
      .toBe(`exercise-media/github_exercises_dataset/${datasetId}.gif`);
  });

  it('exposes media only for the canonical dataset source', () => {
    expect(exerciseMediaPublicUrl('github_exercises_dataset', datasetId))
      .toBe(`/api/exercise-media/gym_keeper_apk/${datasetId}`);
    expect(exerciseMediaPublicUrl('gym_keeper_apk', datasetId)).toBeNull();
    expect(exerciseMediaPublicUrl(null, datasetId)).toBeNull();
    expect(exerciseMediaPublicUrl('coach', datasetId)).toBeNull();
  });

  it('rejects dataset POSTs without a verified GitHub Actions OIDC token', async () => {
    const request = new Request(`https://mezfit.test/api/exercise-media/gym_keeper_apk/${datasetId}`, { method: 'POST' });
    const response = await handleExerciseMediaRoute(request, {} as D1Database, {} as R2Bucket, datasetId);
    expect(response.status).toBe(403);
  });
});
