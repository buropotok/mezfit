/** Shared presentation preference; never part of a workout PLAN or FACT. */
export type WeightRepsPickerMode = 'numbers' | 'wheels';

export const DEFAULT_WEIGHT_REPS_PICKER_MODE: WeightRepsPickerMode = 'numbers';

export function isWeightRepsPickerMode(value: unknown): value is WeightRepsPickerMode {
  return value === 'numbers' || value === 'wheels';
}
