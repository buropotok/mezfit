export type Role = 'coach' | 'client';
export type ExerciseScope = 'global' | 'coach' | 'client';
export type TrackingType = 'weight_reps' | 'time' | 'time_distance' | 'time_reps' | 'time_weight';
export type ExerciseCategoryCode = 'chest' | 'arms' | 'back' | 'legs' | 'shoulders' | 'core' | 'full_body' | 'cardio' | 'other';
export type ExerciseEquipmentCode = 'bodyweight' | 'barbell' | 'dumbbell_single' | 'dumbbell_pair' | 'cable' | 'machine' | 'other';
export type ExerciseSort = 'alphabetical' | 'reference';

export interface AppUser {
  id: number;
  telegramUserId: string;
  username: string | null;
  firstName: string;
  lastName: string | null;
  languageCode: string | null;
  photoUrl: string | null;
  isPremium: boolean;
}

export interface MeResponse {
  user: AppUser;
  roles: Role[];
}

export interface CoachClientListItem {
  relationshipId: number;
  user: AppUser;
}

export interface ClientInvitePreview {
  label: string | null;
  expiresAt: string;
  coach: {
    firstName: string;
    lastName: string | null;
    username: string | null;
  };
}

export interface ExerciseDefinition {
  id: number;
  scope: ExerciseScope;
  name: string;
  description: string | null;
  tracking_type: TrackingType;
  category_code: ExerciseCategoryCode | null;
  equipment_code: ExerciseEquipmentCode | null;
  reference_source: string | null;
  reference_key: string | null;
  reference_media_url: string | null;
  is_favourite: boolean;
  can_edit: boolean;
}

export interface ExerciseDefinitionInput {
  name: string;
  description?: string;
  trackingType: TrackingType;
  categoryCode: ExerciseCategoryCode;
  equipmentCode: ExerciseEquipmentCode;
}

export interface CoachExerciseFilters {
  search?: string;
  categoryCode?: ExerciseCategoryCode | '';
  trackingType?: TrackingType | '';
  favouritesOnly?: boolean;
  sort?: ExerciseSort;
}

interface ApiErrorPayload {
  error?: {
    code?: string;
    message?: string;
  };
}

export class ApiError extends Error {
  readonly status: number;
  readonly code?: string;

  constructor(status: number, message: string, code?: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

async function apiRequest<T>(initData: string, path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  headers.set('x-telegram-init-data', initData);
  if (init?.body) headers.set('content-type', 'application/json');

  const response = await fetch(path, { ...init, headers });
  if (!response.ok) {
    let payload: ApiErrorPayload = {};
    try {
      payload = (await response.json()) as ApiErrorPayload;
    } catch {
      // Keep the generic HTTP error below when the server did not return JSON.
    }
    throw new ApiError(
      response.status,
      payload.error?.message ?? `Request failed with status ${response.status}`,
      payload.error?.code,
    );
  }
  return response.json<T>();
}

export function getMe(initData: string): Promise<MeResponse> {
  return apiRequest(initData, '/api/me');
}

export function addRole(initData: string, role: Role): Promise<MeResponse> {
  return apiRequest(initData, '/api/me/roles', {
    method: 'POST',
    body: JSON.stringify({ role }),
  });
}

export function getCoachClients(initData: string): Promise<{ clients: CoachClientListItem[] }> {
  return apiRequest(initData, '/api/coach/clients');
}

export function createClientInvite(
  initData: string,
  label?: string,
): Promise<{ startParam: string; telegramUrl: string; expiresInDays: number }> {
  return apiRequest(initData, '/api/coach/client-invites', {
    method: 'POST',
    body: JSON.stringify({ label }),
  });
}

export function getCurrentInvite(initData: string): Promise<{ invite: ClientInvitePreview | null }> {
  return apiRequest(initData, '/api/invite/current');
}

export function acceptCurrentInvite(initData: string): Promise<{ ok: true; roles: Role[] }> {
  return apiRequest(initData, '/api/invite/current/accept', { method: 'POST' });
}

export function getClientExercises(
  initData: string,
  clientUserId: number,
  search = '',
): Promise<{ exercises: ExerciseDefinition[] }> {
  const query = search ? `?search=${encodeURIComponent(search)}` : '';
  return apiRequest(initData, `/api/coach/clients/${clientUserId}/exercises${query}`);
}

export function createClientExercise(
  initData: string,
  clientUserId: number,
  input: ExerciseDefinitionInput & { scope: 'coach' | 'client' },
): Promise<{ exercise: ExerciseDefinition }> {
  return apiRequest(initData, `/api/coach/clients/${clientUserId}/exercises`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function getCoachExercises(
  initData: string,
  filters: CoachExerciseFilters = {},
): Promise<{ exercises: ExerciseDefinition[] }> {
  const query = new URLSearchParams();
  if (filters.search) query.set('search', filters.search);
  if (filters.categoryCode) query.set('category', filters.categoryCode);
  if (filters.trackingType) query.set('trackingType', filters.trackingType);
  if (filters.favouritesOnly) query.set('favourites', '1');
  if (filters.sort && filters.sort !== 'alphabetical') query.set('sort', filters.sort);
  const suffix = query.size ? `?${query.toString()}` : '';
  return apiRequest(initData, `/api/coach/exercises${suffix}`);
}

export function getCoachExercise(initData: string, exerciseId: number): Promise<{ exercise: ExerciseDefinition }> {
  return apiRequest(initData, `/api/coach/exercises/${exerciseId}`);
}

export function createCoachExercise(
  initData: string,
  input: ExerciseDefinitionInput,
): Promise<{ exercise: ExerciseDefinition }> {
  return apiRequest(initData, '/api/coach/exercises', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function updateCoachExercise(
  initData: string,
  exerciseId: number,
  input: ExerciseDefinitionInput,
): Promise<{ exercise: ExerciseDefinition }> {
  return apiRequest(initData, `/api/coach/exercises/${exerciseId}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
}

export function archiveCoachExercise(initData: string, exerciseId: number): Promise<{ ok: true }> {
  return apiRequest(initData, `/api/coach/exercises/${exerciseId}`, { method: 'DELETE' });
}

export function setCoachExerciseFavourite(
  initData: string,
  exerciseId: number,
  favourite: boolean,
): Promise<{ ok: true }> {
  return apiRequest(initData, `/api/coach/exercises/${exerciseId}/favourite`, {
    method: 'PUT',
    body: JSON.stringify({ favourite }),
  });
}
