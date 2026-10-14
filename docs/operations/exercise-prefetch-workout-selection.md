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

The **workout exercise selection is currently UI-only**. On confirmation,
the screen displays an explicit message that adding exercises will be connected
in the next stage; the selection remains visible in the open sheet. Neither
Dexie Cloud nor D1 is mutated by this action. The workout domain has not yet
been migrated to local-first Dexie persistence, so selected canonical IDs are
not represented as newly saved session exercises.

The D1 `publicExerciseIds` write adapter introduced in the earlier transitional
implementation is still present in Worker/API code, but **this picker no longer
calls it**. It resolves string IDs to legacy numeric exercise IDs and is not the
target persistence architecture. Evaluate remaining consumers and retire the
unused bridge in a separately reviewed cleanup; do not revive it as an implicit
fallback for the Dexie picker. Other existing workout operations retain their
current D1 behavior until their own migration. This PR changes neither their
authorization nor their transport.

No new Dexie session table, D1 migration, REST catalogue endpoint, R2 import,
or UIkit primitive modification is introduced by this UI-only stage.

## Source reviews

This migration explicitly retires the old
`WorkoutExerciseSelectionSheet` composition on `GlobalExerciseCatalog`
and its tests; only those tests are replaced with cases for the new business
behavior. Existing category filtering tests remain valid and unchanged.
