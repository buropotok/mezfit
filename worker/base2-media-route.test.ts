import { describe, expect, it, vi } from 'vitest';
import worker from './index';

const digest = 'a'.repeat(64);
const path = 'https://mezfit.test/api/exercise-media/base2/v1/';

function fixture() {
  const metadata = { size: 4, httpEtag: '"sample-etag"' };
  const get = vi.fn(async () => ({ ...metadata, body: 'data' }));
  const head = vi.fn(async () => metadata);
  const env = { R2_BINDING_MEZFIT: { get, head } } as unknown as Env;
  const read = (filename: string, method = 'GET') =>
    worker.fetch(new Request(path + filename, { method }), env);
  return { get, head, read };
}

describe('public Base 2 mirror', () => {
  it.each(['gif', 'webp'])('serves immutable %s bytes from the exercise bucket', async extension => {
    const { read, get } = fixture();
    const response = await read(digest + '.' + extension);
    expect(get).toHaveBeenCalledWith('exercises/base2/v1/' + digest + '.' + extension);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('image/' + extension);
    expect(response.headers.get('cache-control')).toContain('immutable');
    expect(await response.text()).toBe('data');
  });

  it('handles HEAD with only the object metadata', async () => {
    const { read, head, get } = fixture();
    const response = await read(digest + '.gif', 'HEAD');
    expect(head).toHaveBeenCalledWith('exercises/base2/v1/' + digest + '.gif');
    expect(get).not.toHaveBeenCalled();
    expect(response.headers.get('content-length')).toBe('4');
    expect(response.body).toBeNull();
  });

  it('restricts the route to known file names, extensions, and read methods', async () => {
    const { read, head, get } = fixture();
    expect((await read(digest + '.gif', 'PUT')).status).toBe(405);
    expect((await read(digest + '.json')).status).toBe(404);
    expect((await read('another-prefix%2F' + digest + '.gif')).status).toBe(404);
    expect(get).not.toHaveBeenCalled();
    expect(head).not.toHaveBeenCalled();
  });
});
