import { describe, expect, it } from 'vitest';
import { exerciseMediaPublicUrl, exerciseMediaR2Key, handleExerciseMediaRoute } from './exercise-media';

const datasetId = '0001';
const importId = '0123456789abcdef0123456789abcdef01234567';

describe('canonical exercise dataset media mapping', () => {
  it('uses immutable import-versioned R2 object keys for staged media', () => {
    expect(exerciseMediaR2Key('github_exercises_dataset', datasetId, importId))
      .toBe(`exercise-media/github_exercises_dataset/versions/${importId}/${datasetId}.gif`);
  });

  it('keeps the legacy helper shape when no version is supplied', () => {
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

  it('returns 304 for a matching validator on the stable public URL', async () => {
    const db={prepare:()=>({bind:()=>({first:async()=>({reference_source:'github_exercises_dataset',reference_key:datasetId,reference_media_url:null,source_metadata_json:JSON.stringify({mezfit_media_version:importId})})})})} as unknown as D1Database;
    const bucket={get:async()=>({body:new Uint8Array([71,73,70]),httpMetadata:{contentType:'image/gif'},httpEtag:'"etag-v1"'})} as unknown as R2Bucket;
    const request=new Request(`https://mezfit.test/api/exercise-media/gym_keeper_apk/${datasetId}`,{headers:{'if-none-match':'"etag-v1"'}});
    const response=await handleExerciseMediaRoute(request,db,bucket,datasetId);
    expect(response.status).toBe(304);
    expect(response.headers.get('etag')).toBe('"etag-v1"');
    expect(response.headers.get('cache-control')).toBe('public, max-age=0, must-revalidate');
  });

  it('rejects dataset POSTs without a verified GitHub Actions OIDC token', async () => {
    const request = new Request(`https://mezfit.test/api/exercise-media/gym_keeper_apk/${datasetId}`, { method: 'POST' });
    const response = await handleExerciseMediaRoute(request, {} as D1Database, {} as R2Bucket, datasetId);
    expect(response.status).toBe(403);
  });
});
