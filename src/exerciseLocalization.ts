// Bundled Gym Keeper exercises are migrated to the APK's exact Russian names.
// Runtime rendering must never guess, translate or transliterate a reference name:
// if the canonical import is wrong, fix the APK mapping/import instead.
export function localizeBundledExerciseName(name: string, _referenceSource?: string | null): string {
  return name;
}

export function exerciseDisplayName(exercise: { name: string; reference_source?: string | null }): string {
  return exercise.name;
}
