// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import Dexie, { type Table } from 'dexie';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MezfitCloudDatabase } from '../data/cloud/database';
import { CLOUD_DATABASE_STORES_V13 } from '../data/cloud/database';
import type { FlexAttributeRow, FlexValueRow } from '../data/cloud/flex-attributes';
import { useCloudConnections } from '../data/cloud/CloudConnectionsProvider';
import { WeightRepsPickerPreferencesRepository } from '../data/cloud/weight-reps-picker-preferences';
import { useWeightRepsPickerMode } from './useWeightRepsPickerMode';

vi.mock('../data/cloud/CloudConnectionsProvider', () => ({ useCloudConnections: vi.fn() }));

class ModeTestDatabase extends Dexie {
  flexAttributes!: Table<FlexAttributeRow, string>;
  flexValues!: Table<FlexValueRow, string>;
  adHocSessions!: Table<unknown, string>;

  constructor() {
    super('weight-reps-mode-hook-' + crypto.randomUUID());
    this.version(1).stores({
      flexAttributes: CLOUD_DATABASE_STORES_V13.flexAttributes,
      flexValues: CLOUD_DATABASE_STORES_V13.flexValues,
      adHocSessions: CLOUD_DATABASE_STORES_V13.adHocSessions.replaceAll('@', ''),
    });
  }
}

const databases: ModeTestDatabase[] = [];
function withActor(actorUserId = 'tg:11') {
  const db = new ModeTestDatabase();
  databases.push(db);
  vi.mocked(useCloudConnections).mockReturnValue({
    db: db as unknown as MezfitCloudDatabase,
    actorUserId,
  } as NonNullable<ReturnType<typeof useCloudConnections>>);
  return new WeightRepsPickerPreferencesRepository(db as unknown as MezfitCloudDatabase, actorUserId);
}

afterEach(async () => {
  cleanup();
  vi.mocked(useCloudConnections).mockReset();
  for (const db of databases.splice(0)) {
    db.close();
    await db.delete();
  }
});

describe('set entry picker mode composition', () => {
  it('restores the persisted mode after unmounting and reopening, independently of set values', async () => {
    const repo = withActor();
    const onError = vi.fn();
    const first = renderHook(() => useWeightRepsPickerMode(onError));
    await waitFor(() => expect(first.result.current.ready).toBe(true));
    expect(first.result.current.mode).toBe('numbers');
    act(() => first.result.current.onModeChange('wheels'));
    await waitFor(async () => expect(await repo.read()).toBe('wheels'));
    first.unmount();

    const second = renderHook(() => useWeightRepsPickerMode(onError));
    await waitFor(() => {
      expect(second.result.current.ready).toBe(true);
      expect(second.result.current.mode).toBe('wheels');
    });
    expect(onError).not.toHaveBeenCalled();
    second.unmount();
  });

  it('serializes rapid taps so that the last chosen mode is the persisted one', async () => {
    const repo = withActor();
    const onError = vi.fn();
    const view = renderHook(() => useWeightRepsPickerMode(onError));
    await waitFor(() => expect(view.result.current.ready).toBe(true));
    act(() => {
      view.result.current.onModeChange('wheels');
      view.result.current.onModeChange('numbers');
      view.result.current.onModeChange('wheels');
    });
    expect(view.result.current.mode).toBe('wheels');
    await waitFor(async () => {
      expect(await repo.read()).toBe('wheels');
      expect(view.result.current.mode).toBe('wheels');
    });
    expect(onError).not.toHaveBeenCalled();
    view.unmount();
  });
});
