// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PublicCategoryArtworkProvider, usePublicCategoryArtwork } from './PublicCategoryArtworkProvider';

const state = vi.hoisted(() => ({
  onRows: null as null | ((rows: unknown[]) => void),
  onProgress: null as null | (() => void),
  rows: [] as unknown[],
  unsubscribed: 0,
}));
vi.mock('../data/cloud/CloudConnectionsProvider', () => ({
  useCloudConnections: () => ({
    db: {
      cloud: {
        blobProgress: {
          subscribe({ next }: { next: () => void }) {
            state.onProgress = next;
            return { unsubscribe: () => { state.unsubscribed++; } };
          },
        },
      },
    },
  }),
}));
vi.mock('../data/exercises/publicCategoryArtwork', async importOriginal => {
  const original = await importOriginal<typeof import('../data/exercises/publicCategoryArtwork')>();
  return {
    ...original,
    PublicCategoryArtworkRepository: class {
      read() { return Promise.resolve(state.rows); }
      observe(next: (rows: unknown[]) => void) {
        state.onRows = next;
        next(state.rows);
        return { unsubscribe: () => { state.unsubscribed++; } };
      }
    },
  };
});

function Probe() {
  const url = usePublicCategoryArtwork('chest');
  return <div data-testid="category-src">{url ?? 'fallback'}</div>;
}

describe('nonblocking synced public category artwork', () => {
  const createObjectURL = vi.fn(() => 'blob:category-chest');
  const revokeObjectURL = vi.fn();
  beforeEach(() => {
    state.onRows = null;
    state.onProgress = null;
    state.rows = [];
    state.unsubscribed = 0;
    vi.useFakeTimers();
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: createObjectURL });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revokeObjectURL });
    createObjectURL.mockClear();
    revokeObjectURL.mockClear();
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('shows fallback without waiting, then renders locally hydrated bytes and revokes URLs on unmount', async () => {
    const view = render(<PublicCategoryArtworkProvider><Probe /></PublicCategoryArtworkProvider>);
    expect(screen.getByTestId('category-src').textContent).toBe('fallback');
    expect(state.onRows).toBeNull();
    await act(async () => { await vi.advanceTimersByTimeAsync(800); });
    const image = new Blob(['image bytes example'], { type: 'image/webp' });
    const row = {
      id: 'category-artwork:chest', realmId: 'rlm-public', owner: null,
      category: 'chest', version: 'a'.repeat(64), mime: 'image/webp',
      size: image.size, image,
    };
    await act(async () => { state.onRows?.([row]); });
    expect(screen.getByTestId('category-src').textContent).toBe('blob:category-chest');
    expect(createObjectURL).toHaveBeenCalledTimes(1);

    // A temporary BlobRef must not discard the last complete image.
    await act(async () => { state.onRows?.([{
      ...row, image: { _bt: 'Blob', ref: '1:abc123def456', size: image.size, ct: image.type },
    }]); });
    expect(screen.getByTestId('category-src').textContent).toBe('blob:category-chest');

    state.rows = [row];
    await act(async () => { state.onProgress?.(); await Promise.resolve(); });
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    view.unmount();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:category-chest');
    expect(state.unsubscribed).toBe(2);
  });
});
