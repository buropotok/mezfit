# Exercise media prefetch and workout selection

## Runtime flow

The authenticated application mounts `PublicExerciseMediaPrefetch` within
`CloudConnectionsProvider`, **regardless of which page is open**. Once the
published canonical catalogue is available in local IndexedDB via Dexie Cloud
sync, it starts a non-blocking HTTP-cache warm-up for the first GIF in each
category (up to nine total, at most two concurrent requests). Requests use the
existing immutable Worker URL pinned to the approved media revision. Responses
are fully read so the browser HTTP cache can commit them. Failures are ignored
for startup, and the effect aborts on logout or provider teardown.

This is **bounded preloading**, not downloading all 1324 GIFs. The remaining
thumbnails use native `loading=lazy` when the user reaches an exercise list;
the detail view uses eager loading. HTTP browser caching is best effort and
does not promise persistent offline media. Dexie exercise metadata remains
available offline independently of GIFs.

## Workout selection

The active-workout picker reuses `PublicExercises` (category list, search,
filters, thumbnails) within the existing UIkit `MezfitBottomSheet`. It accepts
a selection mode with stable cloud IDs, multi-selection across categories,
selection indicators, an explicit confirmation, and a 100-item request cap.
The sheet itself no longer fetches the legacy D1 catalogue from REST.

The current workout mutation still uses the existing D1 session engine.
As a **narrow transitional write adapter only**, the Worker accepts
`publicExerciseIds: string[]`, validates four-digit unique IDs, resolves
them via the existing archived-aware
`exercise_definition(reference_source='github_exercises_dataset', reference_key)`
index into numeric D1 IDs, then invokes the unchanged authorized
`addWorkoutExercises()` mutation. Missing, duplicate or ambiguous mappings
reject the whole request; the existing workout ownership and state checks
remain in effect. This adapter does not make D1 a new catalogue authority.
It should be removed when the workout persistence migration reaches Dexie
Cloud string IDs end to end.

Older callers using `exerciseDefinitionIds: number[]` still work until
their explicitly separate migration. No D1 data migration, new REST list
endpoint, R2 import, or changes to UIkit primitive mechanics are needed.

## Source reviews

This migration explicitly retires the old
`WorkoutExerciseSelectionSheet` composition on `GlobalExerciseCatalog`
and its tests; only those tests are replaced with cases for the new business
behavior. Existing category filtering tests remain valid and unchanged.
