/** Static, app-bundled category artwork from public; no R2/API lookup. */
export const PUBLIC_EXERCISE_CATEGORY_ARTWORK: Readonly<Record<string, string>> = {
  chest: '/muscles_chest.webp',
  arms: '/muscles_arm.webp',
  back: '/muscles_back.webp',
  legs: '/muscles_leg.webp',
  shoulders: '/muscles_shoulders.webp',
  core: '/muscles_core.webp',
  full_body: '/muscles_fullbody.webp',
  cardio: '/gym-keeper/categories/muscles_cardio.svg',
};

/** 'other' has no committed SVG. Keep the existing UIkit icon for that row. */
export function publicExerciseCategoryArtwork(category: string): string | null {
  return Object.hasOwn(PUBLIC_EXERCISE_CATEGORY_ARTWORK, category)
    ? PUBLIC_EXERCISE_CATEGORY_ARTWORK[category]
    : null;
}
