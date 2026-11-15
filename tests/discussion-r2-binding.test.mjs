import { readFile } from 'node:fs/promises';
import { expect, it } from 'vitest';

it('keeps discussion R2 isolated from existing exercise GIF storage', async () => {
  const config = JSON.parse(await readFile(new URL('../wrangler.jsonc', import.meta.url), 'utf8'));
  const buckets = config.r2_buckets;
  expect(buckets).toEqual(expect.arrayContaining([
    { binding: 'R2_BINDING_MEZFIT', bucket_name: 'mezfit' },
    { binding: 'R2_BINDING_DISCUSSION_MEDIA', bucket_name: 'mezfit-discussion-media' },
  ]));
  expect(buckets).toHaveLength(2);
  expect(new Set(buckets.map(bucket => bucket.bucket_name)).size).toBe(2);
});
