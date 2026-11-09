import { liveQuery } from 'dexie';
import {
  DEFAULT_WEIGHT_REPS_PICKER_MODE, isWeightRepsPickerMode, type WeightRepsPickerMode,
} from '../../../shared/weight-reps-picker-mode';
import type { MezfitCloudDatabase } from './database';
import { FlexAttributesRepository } from './flex-attributes';

export const WEIGHT_REPS_PICKER_MODE_KEY = 'picker_weight_reps_mode';

/** The same personal preference applies to Coach and Client set entry. */
export class WeightRepsPickerPreferencesRepository {
  private readonly flex: FlexAttributesRepository<MezfitCloudDatabase>;
  private readonly target: { entityType: 'user'; entityId: string; realmId: string };

  constructor(db: MezfitCloudDatabase, actorUserId: string) {
    this.flex = new FlexAttributesRepository(db, actorUserId);
    this.target = { entityType: 'user', entityId: actorUserId, realmId: actorUserId };
  }

  async read(): Promise<WeightRepsPickerMode> {
    const rows = await this.flex.getValues(this.target, [WEIGHT_REPS_PICKER_MODE_KEY]);
    const row = rows.find(item => item.key === WEIGHT_REPS_PICKER_MODE_KEY);
    // Missing, reset, or unexpected remote data must not prevent entering a set.
    return row?.valueType === 'string' && isWeightRepsPickerMode(row.value)
      ? row.value : DEFAULT_WEIGHT_REPS_PICKER_MODE;
  }

  observe(next: (mode: WeightRepsPickerMode) => void, error: (reason: unknown) => void) {
    return liveQuery(() => this.read()).subscribe({ next, error });
  }

  async set(mode: WeightRepsPickerMode): Promise<void> {
    if (!isWeightRepsPickerMode(mode)) throw new Error('INVALID_WEIGHT_REPS_PICKER_MODE');
    await this.flex.setValue(this.target, {
      key: WEIGHT_REPS_PICKER_MODE_KEY,
      valueType: 'string',
      value: mode === DEFAULT_WEIGHT_REPS_PICKER_MODE ? null : mode,
    });
  }
}
