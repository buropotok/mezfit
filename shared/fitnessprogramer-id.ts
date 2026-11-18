export function isFitnessProgramerExerciseId(id: string): boolean {
  return /^fitnessprogramer:[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id);
}

export function isFitnessProgramerGifId(id: unknown): id is string {
  return typeof id === 'string' && /^fitnessprogramer:gif:[a-f0-9]{64}$/.test(id);
}
