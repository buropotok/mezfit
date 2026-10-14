/** Static, app-bundled SVG artwork from public/gym-keeper/categories; no R2/API lookup. */
export const PUBLIC_EXERCISE_CATEGORY_ARTWORK: Readonly<Record<string, string>> = {
  chest: '/gym-keeper/categories/muscles_chest.svg',
  arms: '/gym-keeper/categories/muscles_arm.svg',
  back: '/gym-keeper/categories/muscles_back.svg',
  legs: '/gym-keeper/categories/muscles_leg.svg',
  shoulders: '/gym-keeper/categories/muscles_shoulders.svg',
  core: '/gym-keeper/categories/muscles_core.svg',
  full_body: '/gym-keeper/categories/muscles_fullbody.svg',
  cardio: '/gym-keeper/categories/muscles_cardio.svg',
};

/** 'other' has no committed SVG. Keep the existing UIkit icon for that row. */
export function publicExerciseCategoryArtwork(category: string): string | null {
  return Object.hasOwn(PUBLIC_EXERCISE_CATEGORY_ARTWORK, category)
    ? PUBLIC_EXERCISE_CATEGORY_ARTWORK[category]
    : null;
}
