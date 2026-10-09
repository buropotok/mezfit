import { localizeBundledExerciseName } from './exerciseLocalization';
import type { SetEntryFactDraft } from './workout/setEntryTypes';
import type { ActiveWorkoutSession, OpenWorkoutSessionSummary, WorkoutSessionState, WorkoutStartInput } from './workout/workoutSessionTypes';

export type Role = 'coach' | 'client';
export type ExerciseScope = 'global' | 'coach' | 'client';
export type TrackingType = 'weight_reps' | 'time' | 'time_distance' | 'time_reps' | 'time_weight';
export type ExerciseCategoryCode = 'chest' | 'arms' | 'back' | 'legs' | 'shoulders' | 'core' | 'full_body' | 'cardio' | 'other';
export type ExerciseEquipmentCode = 'bodyweight' | 'barbell' | 'dumbbell_single' | 'dumbbell_pair' | 'cable' | 'machine' | 'other';
export type ExerciseSort = 'alphabetical' | 'reference';
export type ProgramStatus = 'active' | 'draft' | 'finished';
export type ProgramPhaseStatus = 'pending' | 'active' | 'finished';
export type CreateCoachProgramOwner = { type: 'self' } | { type: 'client'; clientUserId: number };

export type ScheduleOccurrenceStatus = 'scheduled' | 'in_progress' | 'completed';

export interface SchedulePersonSummary {
  id: number;
  firstName: string;
  lastName: string | null;
  username: string | null;
  photoUrl: string | null;
}

export interface ScheduleOccurrence {
  id: number;
  calendarDate: string;
  dateKey: number;
  startMinute: number;
  durationMinutes: number;
  status: ScheduleOccurrenceStatus;
  createdByUserId: number;
  program: { id: number; name: string };
  phase: { id: number; name: string };
  day: { id: number; name: string; position: number };
  coach: SchedulePersonSummary;
  client: SchedulePersonSummary;
  sessionId: number | null;
}

export interface ScheduleOccurrenceTimingInput {
  date: string;
  startMinute: number;
  durationMinutes: number;
}

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

export interface ClientCoachListItem {
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

export interface ProgramListItem {
  id: number;
  userId: number;
  name: string;
  status: ProgramStatus;
  startedAt: string | null;
  finishedAt: string | null;
}

export interface ProgramOwner {
  id: number;
  firstName: string;
  lastName: string | null;
  username: string | null;
  photoUrl: string | null;
}

export interface ProgramOwnerGroup {
  owner: ProgramOwner;
  programs: ProgramListItem[];
}

export interface ProgramPhaseExerciseDetails {
  programExerciseId: number;
  dayId: number;
  dayName: string;
  dayPosition: number;
  position: number;
  setCount: number;
  completed: boolean;
  notes: string | null;
  exercise: ExerciseDefinition;
}

export interface ProgramPhaseDetails {
  id: number;
  name: string;
  position: number;
  status: ProgramPhaseStatus;
  plannedStartDate: string | null;
  plannedEndDate: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  completedExerciseCount: number;
  exerciseCount: number;
  progressPercent: number;
  exercises: ProgramPhaseExerciseDetails[];
}

export interface CoachProgramDetails {
  program: ProgramListItem;
  owner: ProgramOwner;
  ownerType: 'self' | 'client';
  plannedStartDate: string | null;
  plannedEndDate: string | null;
  completedExerciseCount: number;
  exerciseCount: number;
  progressPercent: number;
  phases: ProgramPhaseDetails[];
}

export interface PlannedSetInput {
  setNumber: number;
  weightKg: number | null;
  reps: number | null;
  durationSeconds: number | null;
  distanceMeters: number | null;
}

export interface PlannedSet extends PlannedSetInput {
  id: number;
  programExerciseId: number;
}

export interface ExerciseDefinition {
  id: number;
  scope: ExerciseScope;
  name: string;
  name_en?: string | null;
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
  INVALID_EXERCISE: 'Выберите хотя бы одно упражнение',
  INVALID_NAME: 'Укажите название упражнения',
  INVALID_TRACKING_TYPE: 'Выбран неподдерживаемый тип учёта результата',
  INVALID_CATEGORY: 'Выбрана неподдерживаемая категория',
  INVALID_EQUIPMENT: 'Выбран неподдерживаемый тип оборудования',
  INVALID_FAVOURITE: 'Не удалось изменить избранное',
  INVALID_PROGRAM_NAME: 'Укажите название программы',
  INVALID_PROGRAM_OWNER: 'Выберите владельца программы',
  INVALID_PHASE_NAME: 'Укажите название фазы',
  INVALID_SET_NUMBER: 'Номер подхода указан неверно',
  INVALID_SET_METRICS: 'Параметры подхода указаны неверно',
  INVALID_PROGRAM: 'Выбранная программа недоступна',
  PROGRAM_NOT_FOUND: 'Программа не найдена',
  PROGRAM_EXERCISE_NOT_FOUND: 'Упражнение программы не найдено',
  PHASE_NOT_FOUND: 'Фаза не найдена',
  PHASE_IN_USE: 'Фазу с историей тренировок нельзя удалить',
  PROGRAM_SELECTION_REQUIRED: 'Выберите программу для тренировки',
  PROGRAM_DAY_INVALID: 'Выбранный день программы больше недоступен',
  INVALID_WORKOUT_TYPE: 'Выберите тип тренировки',
  WORKOUT_NOT_FOUND: 'Тренировка не найдена',
  WORKOUT_STATE_INVALID: 'Тренировка находится в неподходящем состоянии',
  SET_NOT_FOUND: 'Подход не найден',
  INVALID_SET_FACT: 'Не удалось сохранить данные подхода',
  INVALID_EXERCISE_ORDER: 'Не удалось сохранить порядок упражнений',
  INVALID_SCHEDULE_ROLE: 'Режим расписания недоступен',
  INVALID_SCHEDULE_RANGE: 'Выбран слишком большой диапазон расписания',
  INVALID_SCHEDULE_TARGET: 'Не удалось определить клиента или день программы',
  INVALID_SCHEDULE_TIME: 'Время тренировки указано неверно',
  SCHEDULE_TARGET_NOT_FOUND: 'День программы недоступен для этого клиента',
  SCHEDULE_DATE_NOT_FOUND: 'Дата находится вне календарного справочника',
  SCHEDULE_OCCURRENCE_NOT_FOUND: 'Тренировка в расписании не найдена',
  SCHEDULE_OCCURRENCE_LOCKED: 'Начатую или завершённую тренировку нельзя переносить',
  INVALID_SCHEDULE_DATE: 'Дата тренировки указана неверно',
  SCHEDULE_OCCURRENCE_INVALID: 'Запланированная тренировка больше недоступна',
  CLIENT_NOT_FOUND: 'Клиент не найден или больше не связан с тренером',
  COACH_NOT_FOUND: 'Тренер не найден или больше не связан с клиентом',
  ROLE_REQUIRED: 'Для этого действия требуется другой режим приложения',
  UNAUTHORIZED: 'Не удалось подтвердить Telegram-сессию',
  NOT_FOUND: 'Запрошенный раздел не найден',
};

const INVITE_START_PARAM_HEADER = 'x-mezfit-invite-start-param';

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

function isValidOccurrenceId(value: unknown): value is number | null {
  return value === null || (typeof value === 'number' && Number.isInteger(value) && value > 0);
}

function validateWorkoutOccurrenceIdentity(session: WorkoutSessionState): void {
  if (session.status === 'draft') {
    const suggestedDay = session.suggestedDay;
    if (suggestedDay) {
      const occurrenceId = suggestedDay.occurrenceId;
      const occurrenceIsValid = suggestedDay.resolution === 'scheduled_today'
        ? typeof occurrenceId === 'number' && Number.isInteger(occurrenceId) && occurrenceId > 0
        : occurrenceId === null;
      if (!occurrenceIsValid) {
        throw new ApiError(502, 'Некорректный ответ тренировки', 'INVALID_API_RESPONSE');
      }
    }
    return;
  }
  if (!isValidOccurrenceId(session.occurrenceId)) {
    throw new ApiError(502, 'Некорректный ответ тренировки', 'INVALID_API_RESPONSE');
  }
}

function localizeWorkoutSession(session: ActiveWorkoutSession): ActiveWorkoutSession {
  validateWorkoutOccurrenceIdentity(session);
  return {
    ...session,
    exercises: session.exercises.map((sessionExercise) => ({
      ...sessionExercise,
      exercise: localizeExercise(sessionExercise.exercise),
    })),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function decodeSchedulePerson(value: unknown): SchedulePersonSummary | null {
  if (!isRecord(value)) return null;
  if (
    typeof value.id !== 'number'
    || !Number.isInteger(value.id)
    || value.id <= 0
    || typeof value.firstName !== 'string'
    || (value.lastName !== null && typeof value.lastName !== 'string')
    || (value.username !== null && typeof value.username !== 'string')
    || (value.photoUrl !== null && typeof value.photoUrl !== 'string')
  ) return null;

  return {
    id: value.id,
    firstName: value.firstName,
    lastName: value.lastName as string | null,
    username: value.username as string | null,
    photoUrl: value.photoUrl as string | null,
  };
}

function decodeScheduleNamed(value: unknown): { id: number; name: string } | null {
  if (!isRecord(value)) return null;
  if (
    typeof value.id !== 'number'
    || !Number.isInteger(value.id)
    || value.id <= 0
    || typeof value.name !== 'string'
  ) return null;
  return { id: value.id, name: value.name };
}

function decodeScheduleOccurrence(value: unknown): ScheduleOccurrence | null {
  if (!isRecord(value)) return null;
  const program = decodeScheduleNamed(value.program);
  const phase = decodeScheduleNamed(value.phase);
  const day = decodeScheduleNamed(value.day);
  const coach = decodeSchedulePerson(value.coach);
  const client = decodeSchedulePerson(value.client);
  const status = value.status;
  if (
    !program
    || !phase
    || !day
    || !coach
    || !client
    || !isRecord(value.day)
    || typeof value.day.position !== 'number'
    || !Number.isInteger(value.day.position)
    || value.day.position < 0
    || typeof value.id !== 'number'
    || !Number.isInteger(value.id)
    || value.id <= 0
    || typeof value.calendarDate !== 'string'
    || !/^\d{4}-\d{2}-\d{2}$/.test(value.calendarDate)
    || typeof value.dateKey !== 'number'
    || !Number.isInteger(value.dateKey)
    || typeof value.startMinute !== 'number'
    || !Number.isInteger(value.startMinute)
    || value.startMinute < 0
    || value.startMinute > 1439
    || typeof value.durationMinutes !== 'number'
    || !Number.isInteger(value.durationMinutes)
    || value.durationMinutes <= 0
    || value.startMinute + value.durationMinutes > 1440
    || (status !== 'scheduled' && status !== 'in_progress' && status !== 'completed')
    || typeof value.createdByUserId !== 'number'
    || !Number.isInteger(value.createdByUserId)
    || value.createdByUserId <= 0
    || (value.sessionId !== null && (
      typeof value.sessionId !== 'number'
      || !Number.isInteger(value.sessionId)
      || value.sessionId <= 0
    ))
  ) return null;

  const expectedDateKey = Number(value.calendarDate.replaceAll('-', ''));
  if (value.dateKey !== expectedDateKey) return null;

  return {
    id: value.id,
    calendarDate: value.calendarDate,
    dateKey: value.dateKey,
    startMinute: value.startMinute,
    durationMinutes: value.durationMinutes,
    status,
    createdByUserId: value.createdByUserId,
    program,
    phase,
    day: { ...day, position: value.day.position },
    coach,
    client,
    sessionId: value.sessionId as number | null,
  };
}

function decodeScheduleOccurrencesResponse(value: unknown): { occurrences: ScheduleOccurrence[] } {
  if (!isRecord(value) || !Array.isArray(value.occurrences)) {
    throw new ApiError(502, 'Некорректный ответ расписания', 'INVALID_API_RESPONSE');
  }
  const occurrences = value.occurrences.map(decodeScheduleOccurrence);
  if (occurrences.some((occurrence) => occurrence === null)) {
    throw new ApiError(502, 'Некорректный ответ расписания', 'INVALID_API_RESPONSE');
  }
  return { occurrences: occurrences as ScheduleOccurrence[] };
}

function decodeScheduleOccurrenceResponse(value: unknown): { occurrence: ScheduleOccurrence } {
  if (!isRecord(value)) {
    throw new ApiError(502, 'Некорректный ответ расписания', 'INVALID_API_RESPONSE');
  }
  const occurrence = decodeScheduleOccurrence(value.occurrence);
  if (!occurrence) {
    throw new ApiError(502, 'Некорректный ответ расписания', 'INVALID_API_RESPONSE');
  }
  return { occurrence };
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

export function getClientCoaches(initData: string): Promise<{ coaches: ClientCoachListItem[] }> {
  return apiRequest(initData, '/api/client/coaches');
}

export function getCoachPrograms(
  initData: string,
): Promise<{ programs: ProgramListItem[]; clients: ProgramOwnerGroup[] }> {
  return apiRequest(initData, '/api/coach/programs');
}

export function getCoachProgramDetails(
  initData: string,
  programId: number,
): Promise<{ details: CoachProgramDetails }> {
  return apiRequest(initData, `/api/coach/programs/${programId}`);
}

export function createCoachProgramPhase(
  initData: string,
  programId: number,
  name: string,
): Promise<{ phase: ProgramPhaseDetails }> {
  return apiRequest(initData, `/api/coach/programs/${programId}/phases`, {
    method: 'POST',
    body: JSON.stringify({ name }),
  });
}

export function createCoachProgramSet(
  initData: string,
  programExerciseId: number,
  input: PlannedSetInput,
): Promise<{ set: PlannedSet }> {
  return apiRequest(initData, `/api/coach/program-exercises/${programExerciseId}/sets`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function deleteCoachProgramPhase(
  initData: string,
  programId: number,
  phaseId: number,
): Promise<{ details: CoachProgramDetails }> {
  return apiRequest(initData, `/api/coach/programs/${programId}/phases/${phaseId}`, { method: 'DELETE' });
}

export function createCoachProgram(
  initData: string,
  name: string,
  owner: CreateCoachProgramOwner,
): Promise<{ program: ProgramListItem }> {
  return apiRequest(initData, '/api/coach/programs', {
    method: 'POST',
    body: JSON.stringify({ name, owner }),
  });
}

export function duplicateCoachProgram(initData: string, programId: number): Promise<{ program: ProgramListItem }> {
  return apiRequest(initData, `/api/coach/programs/${programId}/duplicate`, { method: 'POST' });
}

export function reorderCoachPrograms(initData: string, programIds: number[]): Promise<{ ok: true }> {
  return apiRequest(initData, '/api/coach/programs/reorder', {
    method: 'PUT',
    body: JSON.stringify({ programIds }),
  });
}

export function getClientPrograms(initData: string, coachUserId: number): Promise<{ programs: ProgramListItem[] }> {
  const query = new URLSearchParams({ coachUserId: String(coachUserId) });
  return apiRequest(initData, `/api/client/programs?${query.toString()}`);
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

export function getCurrentInvite(
  initData: string,
  startParam?: string | null,
): Promise<{ invite: ClientInvitePreview | null }> {
  const headers = new Headers();
  if (startParam) headers.set(INVITE_START_PARAM_HEADER, startParam);
  return apiRequest(initData, '/api/invite/current', { headers });
}

export function acceptCurrentInvite(
  initData: string,
  startParam?: string | null,
): Promise<{ ok: true; roles: Role[] }> {
  const headers = new Headers();
  if (startParam) headers.set(INVITE_START_PARAM_HEADER, startParam);
  return apiRequest(initData, '/api/invite/current/accept', { method: 'POST', headers });
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

export async function getClientExerciseHistory(
  initData: string,
  clientUserId: number,
): Promise<{ exercises: ExerciseDefinition[] }> {
  const result = await apiRequest<{ exercises: ExerciseDefinition[] }>(
    initData,
    `/api/coach/clients/${clientUserId}/exercise-history`,
  );
  return { exercises: result.exercises.map(localizeExercise) };
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

export async function createCoachExercise(
  initData: string,
  input: ExerciseDefinitionInput,
): Promise<{ exercise: ExerciseDefinition }> {
  const result = await apiRequest<{ exercise: ExerciseDefinition }>(initData, '/api/coach/exercises', {
    method: 'POST',
    body: JSON.stringify(input),
  });
  return { exercise: localizeExercise(result.exercise) };
}

export async function updateCoachExercise(
  initData: string,
  exerciseId: number,
  input: ExerciseDefinitionInput,
): Promise<{ exercise: ExerciseDefinition }> {
  const result = await apiRequest<{ exercise: ExerciseDefinition }>(initData, `/api/coach/exercises/${exerciseId}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
  return { exercise: localizeExercise(result.exercise) };
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

export async function getScheduleOccurrences(
  initData: string,
  role: Role,
  from: string,
  to: string,
  signal?: AbortSignal,
): Promise<{ occurrences: ScheduleOccurrence[] }> {
  const query = new URLSearchParams({ role, from, to });
  const response = await apiRequest<unknown>(
    initData,
    `/api/schedule?${query.toString()}`,
    signal ? { signal } : undefined,
  );
  return decodeScheduleOccurrencesResponse(response);
}

export async function createScheduleOccurrence(
  initData: string,
  input: ScheduleOccurrenceTimingInput & { clientUserId: number; programDayId: number },
): Promise<{ occurrence: ScheduleOccurrence }> {
  const response = await apiRequest<unknown>(initData, '/api/schedule/occurrences', {
    method: 'POST',
    body: JSON.stringify(input),
  });
  return decodeScheduleOccurrenceResponse(response);
}

export async function rescheduleScheduleOccurrence(
  initData: string,
  occurrenceId: number,
  input: ScheduleOccurrenceTimingInput,
): Promise<{ occurrence: ScheduleOccurrence }> {
  const response = await apiRequest<unknown>(initData, `/api/schedule/occurrences/${occurrenceId}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
  return decodeScheduleOccurrenceResponse(response);
}

export async function cancelScheduleOccurrence(
  initData: string,
  occurrenceId: number,
): Promise<{ ok: true }> {
  const response = await apiRequest<unknown>(
    initData,
    `/api/schedule/occurrences/${occurrenceId}`,
    { method: 'DELETE' },
  );
  if (!isRecord(response) || response.ok !== true) {
    throw new ApiError(502, 'Некорректный ответ расписания', 'INVALID_API_RESPONSE');
  }
  return { ok: true };
}

export async function getWorkoutExerciseOptions(
  initData: string,
  categoryCode?: ExerciseCategoryCode,
): Promise<{ exercises: ExerciseDefinition[] }> {
  const suffix = categoryCode ? `?category=${encodeURIComponent(categoryCode)}` : '';
  const result = await apiRequest<{ exercises: ExerciseDefinition[] }>(
    initData,
    `/api/workout-sessions/exercises${suffix}`,
  );
  return { exercises: result.exercises.map(localizeExercise) };
}

export async function addWorkoutSessionExercises(
  initData: string,
  workoutSessionId: number,
  exerciseDefinitionIds: number[],
): Promise<{ session: ActiveWorkoutSession }> {
  const result = await apiRequest<{ session: ActiveWorkoutSession }>(initData, `/api/workout-sessions/${workoutSessionId}/exercises`, {
    method: 'POST',
    body: JSON.stringify({ exerciseDefinitionIds }),
  });
  return { session: localizeWorkoutSession(result.session) };
}

export async function getCurrentWorkoutSession(
  initData: string,
): Promise<{ session: OpenWorkoutSessionSummary | null }> {
  const response = await apiRequest<unknown>(initData, '/api/workout-sessions/current');
  if (!isRecord(response)) {
    throw new ApiError(502, 'Некорректный ответ тренировки', 'INVALID_API_RESPONSE');
  }
  if (response.session === null) return { session: null };
  if (
    !isRecord(response.session)
    || typeof response.session.sessionId !== 'number'
    || !Number.isInteger(response.session.sessionId)
    || response.session.sessionId <= 0
    || (response.session.status !== 'draft' && response.session.status !== 'active')
  ) {
    throw new ApiError(502, 'Некорректный ответ тренировки', 'INVALID_API_RESPONSE');
  }
  return {
    session: {
      sessionId: response.session.sessionId,
      status: response.session.status,
    },
  };
}

export async function initializeWorkoutSession(
  initData: string,
  trainingPlanId: number | null = null,
  localDate: string | null = null,
): Promise<{ session: WorkoutSessionState }> {
  const result = await apiRequest<{ session: WorkoutSessionState }>(initData, '/api/workout-sessions/initialize', {
    method: 'POST',
    body: JSON.stringify({
      ...(trainingPlanId === null ? {} : { trainingPlanId }),
      ...(localDate === null ? {} : { localDate }),
    }),
  });
  validateWorkoutOccurrenceIdentity(result.session);
  return {
    session: result.session.status === 'draft' ? result.session : localizeWorkoutSession(result.session),
  };
}

export async function startWorkoutSession(
  initData: string,
  workoutSessionId: number,
  input: WorkoutStartInput,
): Promise<{ session: ActiveWorkoutSession }> {
  const result = await apiRequest<{ session: ActiveWorkoutSession }>(initData, `/api/workout-sessions/${workoutSessionId}/start`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
  return { session: localizeWorkoutSession(result.session) };
}

export async function saveWorkoutSessionSet(
  initData: string,
  workoutSessionId: number,
  sessionSetId: number,
  fact: SetEntryFactDraft,
): Promise<{ session: ActiveWorkoutSession }> {
  const result = await apiRequest<{ session: ActiveWorkoutSession }>(initData, `/api/workout-sessions/${workoutSessionId}/sets/${sessionSetId}`, {
    method: 'PUT',
    body: JSON.stringify({ fact }),
  });
  return { session: localizeWorkoutSession(result.session) };
}

export async function reorderWorkoutSessionExercises(
  initData: string,
  workoutSessionId: number,
  sessionExerciseIds: number[],
): Promise<{ session: ActiveWorkoutSession }> {
  const result = await apiRequest<{ session: ActiveWorkoutSession }>(initData, `/api/workout-sessions/${workoutSessionId}/exercises/reorder`, {
    method: 'PUT',
    body: JSON.stringify({ sessionExerciseIds }),
  });
  return { session: localizeWorkoutSession(result.session) };
}

export async function completeWorkoutSession(
  initData: string,
  workoutSessionId: number,
): Promise<{ session: ActiveWorkoutSession }> {
  const result = await apiRequest<{ session: ActiveWorkoutSession }>(initData, `/api/workout-sessions/${workoutSessionId}/complete`, {
    method: 'POST',
    body: JSON.stringify({}),
  });
  return { session: localizeWorkoutSession(result.session) };
}
