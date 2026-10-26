/** Exact quarter-kilogram encoding shared by weight-only and weight/reps pickers. */
export const KILOGRAM_VALUES = Array.from({ length: 400 }, (_, index) => index);
export const FRACTION_VALUES = [0, 25, 50, 75] as const;

export function parseWeightKg(weightKg: number, owner: 'WeightPicker' | 'WeightRepsPicker') {
  if (!Number.isFinite(weightKg) || weightKg < 0 || weightKg > 399.75) {
    throw new Error(`${owner} weightKg must be from 0 to 399.75`);
  }
  // Multiplication by four is exact for the supported quarter-kilogram values.
  if (!Number.isInteger(weightKg * 4)) {
    throw new Error(`${owner} weightKg must use 0.25 kg increments`);
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
