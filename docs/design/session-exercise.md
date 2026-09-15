# SessionExercise module contract

## Scope

`SessionExercise` is the controlled React card for one factual exercise inside an active `workout_session`. It is the direct UI parent of `SetEntry`.

The module does not load server state and does not persist directly. The workout owner supplies a complete projection of `session_exercise`, its canonical `exercise_definition`, and every `session_set` with PLAN / PREVIOUS / FACT context.

```text
WorkoutSession owner
  -> SortableList<SessionExercise>
      -> SessionExercise
          -> List<SessionSet>
          -> SetEntry
              -> onSave(fact)
          -> onSaveSet(identity + fact)
  <- canonical workout state after persistence
```

## UI composition

The approved visual is a flat card differentiated from the page canvas only by `--ui-color-surface`. The resting card has no border and no shadow. The shared sortable overlay is expected to own the raised drag presentation once the list primitive supports the approved card activation behavior.

Reuse existing UI Kit primitives without changing their mechanics or visuals:

- header content: `List` + `ListItem`;
- exercise media: existing `ExerciseMedia`;
- progress and RPE: `Badge`;
- exercise options and explicit collapse affordance: `IconButton`;
- sets: `List` + `ListItem`;
- notes and progress text: `Text`.

Feature-owned elements exist only where the UI Kit has no suitable primitive: the borderless card wrapper, compact set-status circle, compact in-card set separator, and progress bar.

The options and collapse `IconButton`s are siblings of the header `ListItem`, not nested buttons. The main header `ListItem` remains the short-press collapse target.

## Collapse and DnD

A short press on the header `ListItem` toggles expanded/collapsed state. The explicit chevron `IconButton` performs the same action. Collapse is local presentation state and is not persisted.

The approved DnD interaction remains: long press on the header starts exercise reorder, while the expanded set body, options button and collapse button must not initiate drag.

`SessionExercise` deliberately does not implement a custom pointer/long-press system. DnD must remain owned by the shared sortable primitive.

### Current UI Kit integration blocker

The current `SortableList` is not yet sufficient for the approved expanded exercise-card use case and must be extended before this module is wired into the workout screen:

- listeners and `touch-action: none` currently live on the whole sortable row, so an expanded card can block vertical touch scrolling even when its body uses `data-no-dnd`;
- the primitive has no supported activation-region setting that would let only the header act as the long-press drag surface without displaying a drag handle;
- the primitive currently renders a fixed separator between rows, while the approved exercise cards are separate contrast-only cards with spacing and no list divider between them.

Do not work around these constraints with feature-owned DnD, DOM interception, CSS overrides of the shared primitive, or a visible drag handle. The UI Kit should be expanded with an explicit supported configuration while preserving its existing default behavior for current consumers.

When that primitive support exists, the outer workout owner will receive reordered item IDs and persist `session_exercise.position`. Reorder is not an output of `SessionExercise` itself.

## Data sources

The card renders factual session state only after workout start:

- exercise identity and display metadata: canonical `exercise_definition` referenced by `session_exercise.exercise_definition_id`;
- exercise note: `session_exercise.notes`;
- ordering/status: `session_exercise.position` / `session_exercise.status`;
- PLAN: `session_set.planned_*`, represented as `SetMetrics | null`;
- FACT: `session_set.actual_*` plus factual metadata projected as `ExistingSetFact | null`;
- PREVIOUS: the same numbered set of the same exercise in the previous workout, resolved by the parent/backend projection before rendering;
- source IDs (`source_program_exercise_id`, `source_program_set_id`) are provenance only.

The component never reads PLAN back from `program_set` after the session snapshot exists.

## Public React API

```ts
interface SessionExerciseProps {
  context: SessionExerciseContext;
  data: SessionExerciseData;
  defaultCollapsed?: boolean;
  onSaveSet: (input: SaveSessionSetInput) => Promise<void>;
  onOpenExerciseMenu: (sessionExerciseId: number) => void;
  onOpenHistory: (exerciseDefinitionId: number) => void;
  onOpenChat: () => void;
}
```

Workout context:

```ts
interface SessionExerciseContext {
  workoutSessionId: number;
  workoutDate: string; // YYYY-MM-DD
  program: { id: number; name: string } | null;
}
```

`program = null` is the canonical value for an own/ad-hoc workout outside a program.

Exercise data:

```ts
interface SessionExerciseData {
  sessionExerciseId: number;
  workoutSessionId: number;
  sourceProgramExerciseId: number | null;
  position: number;
  status: 'planned' | 'active' | 'completed' | 'skipped' | 'inactive';
  notes: string | null;
  exercise: ExerciseDefinition;
  sets: SessionExerciseSetData[];
}
```

Set data:

```ts
interface SessionExerciseSetData {
  sessionSetId: number;
  sourceProgramSetId: number | null;
  position: number;
  status: 'pending' | 'completed' | 'skipped';
  plan: SetMetrics | null;
  previous: PreviousSet | null;
  fact: ExistingSetFact | null;
}
```

## Display rules

Header:

- title: `exerciseDisplayName(exercise)`;
- subtitle: localized category, localized equipment, and set count;
- progress badge: completed set count / total set count;
- exercise media: `ExerciseMedia variant="thumbnail"`;
- notes are shown only when `session_exercise.notes` is non-null.

Each set row:

- number is `position + 1`;
- a completed set uses the completed status indicator;
- FACT is primary when present, otherwise the row says `ввести факт`;
- PLAN is shown only when the projected plan contains relevant metrics;
- PREVIOUS is shown only when the projected previous set contains relevant metrics;
- RPE is shown as a `Badge` only when factual RPE exists.

Metric formatting follows `exercise.tracking_type` and canonical storage units:

```text
weight_reps    -> 80 кг × 10
time           -> 12:30
time_distance  -> 18:42 · 3,20 км
time_reps      -> 02:00 · 35 повт.
time_weight    -> 01:00 · 20 кг
```

## SetEntry boundary

Pressing a set row is local state. `SessionExercise` selects that `sessionSetId` and opens `SetEntry` without a GET request.

The `SetEntryData` projection is built from the already supplied session projection:

```text
exercise definition -> exercise identity + tracking type
session set PLAN     -> SetEntry.plan
session set PREVIOUS -> SetEntry.previous
session set FACT     -> SetEntry.fact
session/program context -> display identity
```

For an own workout, `SetEntry.identity.programId` and `programName` are both `null`. `SetEntry` then displays only the workout date in its metadata line.

## Outputs

Saving a set emits only persistence identity plus editable FACT to the workout owner:

```ts
interface SaveSessionSetInput {
  workoutSessionId: number;
  sessionExerciseId: number;
  sessionSetId: number;
  fact: SetEntryFactDraft;
}
```

The workout owner then calls the typed API layer and reconciles the canonical server response. `SessionExercise` performs no direct fetch.

Other external actions:

- options button -> `onOpenExerciseMenu(sessionExerciseId)` -> workout/menu owner;
- SetEntry history -> `onOpenHistory(exerciseDefinitionId)` -> history/navigation owner;
- SetEntry chat -> `onOpenChat()` -> Telegram/navigation owner.

Collapse state, selected set state, and SetEntry open/close state are local presentation state and are not emitted.

## Persistence note

The current `session_set` migration already owns planned/actual metrics and status. `SetEntryFactDraft` additionally contains set label, RPE, comment, and bands; their backend/D1 persistence remains a separate workout persistence task. `SessionExercise` deliberately keeps persistence behind `onSaveSet` rather than inventing a local transport path.
