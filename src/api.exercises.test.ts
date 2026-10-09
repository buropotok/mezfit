import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ApiError,
  getClientExerciseHistory,
  getCoachExercises,
  getWorkoutExerciseOptions,
} from './api';

const exercise = {
  id: 11,
  scope: 'global',
  name: 'Barbell Bench Press',
  name_en: 'Barbell Bench Press',
  description: 'Bench press',
  tracking_type: 'weight_reps',
  category_code: 'chest',
  equipment_code: 'barbell',
  reference_source: 'github_exercises_dataset',
  reference_key: '0001',
  reference_media_url: 'https://cdn.example/0001.gif',
  is_favourite: false,
  can_edit: true,
};

function response(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('exercise API decoding', () => {
  it('validates and localizes the coach catalogue before returning it', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response({ exercises: [exercise] })));

    const result = await getCoachExercises('init-data');

    expect(result.exercises).toHaveLength(1);
    expect(result.exercises[0]).toMatchObject({
      id: 11,
      name_en: 'Barbell Bench Press',
      tracking_type: 'weight_reps',
      category_code: 'chest',
    });
  });

  it('rejects malformed exercise payloads before they can hydrate IndexedDB', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response({
      exercises: [{ ...exercise, tracking_type: 'unsupported' }],
    })));

    await expect(getClientExerciseHistory('init-data', 42)).rejects.toMatchObject({
      name: 'ApiError',
      code: 'INVALID_API_RESPONSE',
      status: 502,
    } satisfies Partial<ApiError>);
  });

  it('requests the complete workout catalogue when category is omitted', async () => {
    const fetchMock = vi.fn().mockResolvedValue(response({ exercises: [exercise] }));
    vi.stubGlobal('fetch', fetchMock);

    await getWorkoutExerciseOptions('init-data');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/workout-sessions/exercises');
  });
});
