import { localizeBundledExerciseName } from './exerciseLocalization';

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

const russianApiErrors: Record<string, string> = {
  EXERCISE_EXISTS: 'Упражнение с таким названием уже существует',
  EXERCISE_READ_ONLY: 'Базовое упражнение нельзя изменять',
  EXERCISE_NOT_FOUND: 'Упражнение не найдено',
  INVALID_NAME: 'Укажите название упражнения',
  INVALID_TRACKING_TYPE: 'Выбран неподдерживаемый тип учёта результата',
  INVALID_CATEGORY: 'Выбрана неподдерживаемая категория',
  INVALID_EQUIPMENT: 'Выбран неподдерживаемый тип оборудования',
  INVALID_FAVOURITE: 'Не удалось изменить избранное',
  CLIENT_NOT_FOUND: 'Клиент не найден или больше не связан с тренером',
  ROLE_REQUIRED: 'Для этого действия требуется другой режим приложения',
  UNAUTHORIZED: 'Не удалось подтвердить Telegram-сессию',
  NOT_FOUND: 'Запрошенный раздел не найден',
};

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

function localizeExercise(exercise: ExerciseDefinition): ExerciseDefinition {
  return {
    ...exercise,
    name: localizeBundledExerciseName(exercise.name, exercise.reference_source),
  };
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
    const code = payload.error?.code;
    throw new ApiError(
      response.status,
      (code && russianApiErrors[code]) ?? payload.error?.message ?? `Ошибка запроса: ${response.status}`,
      code,
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

export async function getClientExercises(
  initData: string,
  clientUserId: number,
  search = '',
): Promise<{ exercises: ExerciseDefinition[] }> {
  const result = await apiRequest<{ exercises: ExerciseDefinition[] }>(initData, `/api/coach/clients/${clientUserId}/exercises`);
  const needle = search.trim().toLocaleLowerCase('ru-RU');
  const exercises = result.exercises.map(localizeExercise).filter((exercise, index) => {
    if (!needle) return true;
    const sourceName = result.exercises[index]?.name.toLocaleLowerCase('en-US') ?? '';
    return exercise.name.toLocaleLowerCase('ru-RU').includes(needle) || sourceName.includes(needle);
  });
  return { exercises };
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

export async function getCoachExercises(
  initData: string,
  filters: CoachExerciseFilters = {},
): Promise<{ exercises: ExerciseDefinition[] }> {
  const query = new URLSearchParams();
  if (filters.search?.trim()) query.set('search', filters.search.trim());
  if (filters.categoryCode) query.set('category', filters.categoryCode);
  if (filters.trackingType) query.set('trackingType', filters.trackingType);
  if (filters.favouritesOnly) query.set('favourites', '1');
  if (filters.sort && filters.sort !== 'alphabetical') query.set('sort', filters.sort);
  const suffix = query.size ? `?${query.toString()}` : '';
  const result = await apiRequest<{ exercises: ExerciseDefinition[] }>(initData, `/api/coach/exercises${suffix}`);
  return { exercises: result.exercises.map(localizeExercise) };
}

export async function getCoachExercise(initData: string, exerciseId: number): Promise<{ exercise: ExerciseDefinition }> {
  const result = await apiRequest<{ exercise: ExerciseDefinition }>(initData, `/api/coach/exercises/${exerciseId}`);
  return { exercise: localizeExercise(result.exercise) };
}