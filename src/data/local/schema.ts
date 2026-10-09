import type {
  ExerciseCategoryCode,
  ExerciseEquipmentCode,
  ExerciseScope,
  TrackingType,
} from '../../api';
import type { ResistanceBandCode, SetLabel } from '../../workout/setEntryTypes';

export type LocalEntityId = string;

export interface LocalServerBackedEntity {
  id: LocalEntityId;
  serverId?: number;
}

export interface LocalUserRow {
  serverId: number;
  telegramUserId: string;
  username: string | null;
  firstName: string;
  lastName: string | null;
  languageCode: string | null;
  photoUrl: string | null;
  isPremium: boolean;
  createdAt: string;
  updatedAt: string;
}

export type CoachClientStatus = 'active' | 'inactive';

export interface LocalCoachClientRow {
  relationshipId: number;
  coachUserId: number;
  clientUserId: number;
  inviteId: number | null;
  status: CoachClientStatus;
  createdAt: string;
  updatedAt: string;
}

export interface LocalExerciseDefinitionRow extends LocalServerBackedEntity {
  scope: ExerciseScope;
  ownerCoachUserId: number | null;
  ownerClientUserId: number | null;
  name: string;
  nameEn: string | null;
  description: string | null;
  trackingType: TrackingType;
  primaryMuscle: string | null;
  equipment: string | null;
  categoryCode: ExerciseCategoryCode | null;
  equipmentCode: ExerciseEquipmentCode | null;
  referenceSource: string | null;
  referenceKey: string | null;
  referenceMediaUrl: string | null;
  referenceOrder: number | null;
  sourceMetadataJson: string | null;
  isArchived: boolean;
  createdByUserId: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface LocalExerciseDefinitionOverrideRow {
  id: string;
  coachUserId: number;
  exerciseDefinitionId: LocalEntityId;
  name: string;
  description: string | null;
  trackingType: TrackingType;
  categoryCode: ExerciseCategoryCode;
  equipmentCode: ExerciseEquipmentCode;
  createdAt: string;
  updatedAt: string;
}

export interface LocalExerciseFavouriteRow {
  id: string;
  coachUserId: number;
  exerciseDefinitionId: LocalEntityId;
  createdAt: string;
}

export interface LocalExerciseMembershipRow {
  id: string;
  contextKey: string;
  exerciseDefinitionId: LocalEntityId;
  isFavourite: boolean;
  canEdit: boolean;
}

export interface LocalTrainingPlanRow extends LocalServerBackedEntity {
  userId: number;
  ownerCoachUserId: number | null;
  name: string;
  createdByUserId: number;
  position: number;
  createdAt: string;
  updatedAt: string;
}

export type ProgramPhaseStatus = 'pending' | 'active' | 'finished';

export interface LocalProgramPhaseRow extends LocalServerBackedEntity {
  trainingPlanId: LocalEntityId;
  name: string;
  position: number;
  status: ProgramPhaseStatus;
  plannedStartDate: string | null;
  plannedEndDate: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  createdByUserId: number;
  createdAt: string;
  updatedAt: string;
}

export type ProgramChildStatus = 'active' | 'deprecated';

export interface LocalProgramDayRow extends LocalServerBackedEntity {
  programPhaseId: LocalEntityId;
  name: string;
  position: number;
  createdByUserId: number;
  status: ProgramChildStatus;
  deprecatedAt: string | null;
  deprecatedByUserId: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface LocalProgramExerciseRow extends LocalServerBackedEntity {
  programDayId: LocalEntityId;
  exerciseDefinitionId: LocalEntityId;
  position: number;
  createdByUserId: number;
  status: ProgramChildStatus;
  deprecatedAt: string | null;
  deprecatedByUserId: number | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface LocalProgramSetRow extends LocalServerBackedEntity {
  programExerciseId: LocalEntityId;
  position: number;
  reps: number | null;
  weightKg: number | null;
  durationSeconds: number | null;
  distanceMeters: number | null;
  createdByUserId: number;
  status: ProgramChildStatus;
  deprecatedAt: string | null;
  deprecatedByUserId: number | null;
  createdAt: string;
  updatedAt: string;
}

export type WorkoutOccurrenceStatus = 'scheduled' | 'in_progress' | 'completed' | 'cancelled';

export interface LocalWorkoutOccurrenceRow extends LocalServerBackedEntity {
  coachUserId: number;
  clientUserId: number;
  programDayId: LocalEntityId;
  calendarDate: string;
  calendarDateKey: number;
  startMinute: number;
  durationMinutes: number;
  status: WorkoutOccurrenceStatus;
  createdByUserId: number;
  createdAt: string;
  updatedAt: string;
}

export type WorkoutSessionStatus = 'draft' | 'active' | 'completed';

export interface LocalWorkoutSessionRow extends LocalServerBackedEntity {
  userId: number;
  sourceProgramPhaseId: LocalEntityId | null;
  sourceProgramDayId: LocalEntityId | null;
  occurrenceId: LocalEntityId | null;
  startedByUserId: number;
  /**
   * Current FACT editor in the local domain model.
   * The current server only allows the workout user to mutate FACT, so hydration maps this to userId.
   * When server-side ownership transfer is implemented, this field must map the authoritative owner.
   */
  factOwnerUserId: number;
  status: WorkoutSessionStatus;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export type SessionExerciseStatus = 'planned' | 'active' | 'completed' | 'skipped' | 'inactive';

export interface LocalSessionExerciseRow extends LocalServerBackedEntity {
  workoutSessionId: LocalEntityId;
  exerciseDefinitionId: LocalEntityId;
  sourceProgramExerciseId: LocalEntityId | null;
  position: number;
  status: SessionExerciseStatus;
  addedByUserId: number;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export type SessionSetStatus = 'pending' | 'completed' | 'skipped';

export interface LocalSessionSetRow extends LocalServerBackedEntity {
  sessionExerciseId: LocalEntityId;
  sourceProgramSetId: LocalEntityId | null;
  position: number;
  plannedReps: number | null;
  plannedWeightKg: number | null;
  plannedDurationSeconds: number | null;
  plannedDistanceMeters: number | null;
  actualReps: number | null;
  actualWeightKg: number | null;
  actualDurationSeconds: number | null;
  actualDistanceMeters: number | null;
  setLabel: SetLabel | null;
  rpe: number | null;
  comment: string | null;
  bands: ResistanceBandCode[];
  status: SessionSetStatus;
  createdByUserId: number;
  updatedByUserId: number;
  createdAt: string;
  updatedAt: string;
}

export type SyncScopeType =
  | 'occurrence'
  | 'workout_session'
  | 'program'
  | 'exercise_global'
  | 'exercise_coach'
  | 'exercise_client';

export type SyncScopeStatus = 'clean' | 'dirty' | 'syncing' | 'retry_wait' | 'conflict';

export interface LocalSyncScopeRow {
  scopeKey: string;
  scopeType: SyncScopeType;
  localRevision: number;
  serverRevision: number | null;
  status: SyncScopeStatus;
  attemptCount: number;
  nextRetryAt: number | null;
  lastError: string | null;
  inflightRequestId: string | null;
  inflightRevision: number | null;
  remoteChanged: boolean;
  updatedAt: number;
}

export interface LocalSyncRemoteStateRow {
  id: 'default';
  remoteCursor: number | null;
  updatedAt: number;
}
