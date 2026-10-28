/** Exact quarter-kilogram encoding shared by weight-only and weight/reps pickers. */
export const KILOGRAM_VALUES = Array.from({ length: 400 }, (_, index) => index);
export const FRACTION_VALUES = [0, 25, 50, 75] as const;

export function parseWeightKg(weightKg: number, owner: 'WeightPicker' | 'WeightRepsPicker') {
  if (!Number.isFinite(weightKg) || weightKg < 0
    || (owner === 'WeightPicker' && weightKg > 399.75)) {
    throw new Error(`${owner} weightKg must be ${owner === 'WeightPicker' ? 'from 0 to 399.75' : 'non-negative'}`);
  }
  // WeightPicker remains a bounded wheel. The number-keypad WeightRepsPicker
  // has no business maximum, but quarter values must be exactly representable.
  if (!Number.isSafeInteger(weightKg * 4)) {
    throw new Error(`${owner} weightKg must use 0.25 kg increments within JS safe precision`);
  }
  const quarters = weightKg * 4;
  return {
    kilograms: Math.floor(quarters / 4),
    fraction: (quarters % 4) * 25,
  };
}

export function formatWeightFraction(value: number) {
  if (value === 0) return '00';
  if (value === 50) return '5';
  return String(value);
}

export function formatWeightFractionAria(value: number) {
  if (value === 0) return '0,00';
  if (value === 50) return '0,5';
  return `0,${value}`;
}

export function combineWeightKg(kilograms: number, fraction: number) {
  return kilograms + fraction / 100;
}
