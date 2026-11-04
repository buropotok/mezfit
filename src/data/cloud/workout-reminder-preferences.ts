import { liveQuery } from 'dexie';
import type { MezfitCloudDatabase } from './database';
import { FlexAttributesRepository } from './flex-attributes';

export const WORKOUT_REMINDER_KEYS = {
  client: 'notify_client_workouts',
  coached: 'notify_coach_client_workouts',
  own: 'notify_coach_own_workouts',
} as const;

export type WorkoutReminderPreference = keyof typeof WORKOUT_REMINDER_KEYS;
export type WorkoutReminderPreferences = Record<WorkoutReminderPreference, boolean>;

/** A missing personal preference means enabled. A malformed value fails closed. */
export const DEFAULT_WORKOUT_REMINDER_PREFERENCES: Readonly<WorkoutReminderPreferences> = {
  client: true,
  coached: true,
  own: true,
};

export class WorkoutReminderPreferencesRepository {
  private readonly flex: FlexAttributesRepository<MezfitCloudDatabase>;
  private readonly target: { entityType: 'user'; entityId: string; realmId: string };

  constructor(db: MezfitCloudDatabase, actorUserId: string) {
    this.flex = new FlexAttributesRepository(db, actorUserId);
    this.target = { entityType: 'user', entityId: actorUserId, realmId: actorUserId };
  }

  async read(): Promise<WorkoutReminderPreferences> {
    const rows = await this.flex.getValues(this.target, Object.values(WORKOUT_REMINDER_KEYS));
    const preferences = { ...DEFAULT_WORKOUT_REMINDER_PREFERENCES };
    for (const [key, attribute] of Object.entries(WORKOUT_REMINDER_KEYS) as [WorkoutReminderPreference, string][]) {
      const row = rows.find(item => item.key === attribute);
      if (!row || row.value === null) continue;
      if (row.valueType !== 'boolean' || typeof row.value !== 'boolean') {
        throw new Error('INVALID_REMINDER_PREFERENCE');
      }
      preferences[key] = row.value;
    }
    return preferences;
  }

  observe(next: (values: WorkoutReminderPreferences) => void, error: (reason: unknown) => void) {
    return liveQuery(() => this.read()).subscribe({ next, error });
  }

  async set(key: WorkoutReminderPreference, enabled: boolean): Promise<void> {
    if (!Object.hasOwn(WORKOUT_REMINDER_KEYS, key) || typeof enabled !== 'boolean') {
      throw new Error('INVALID_REMINDER_PREFERENCE');
    }
    await this.flex.setValue(this.target, {
      key: WORKOUT_REMINDER_KEYS[key], valueType: 'boolean', value: enabled,
    });
  }
}
