# SetEntry module contract

## Scope

`SetEntry` is the shared controlled React modal for one set and has two explicit domain modes:

- `workout` edits FACT for a live workout session;
- `plan` lets a coach author a planned set for a program exercise.

Opening `SetEntry` never triggers a read request. The parent supplies the complete rendering context, including the previous analogous set. Persistence is mode-specific.

```text
workout
Workout owner
  -> SessionExercise
      -> SetEntry(mode="workout", data, onSave)
          -> local FACT draft
          -> onSave(fact)
      <- canonical session state after save

plan
Coach program authoring
  -> SetEntry(mode="plan", programExerciseId, data)
      -> local planned-metrics draft
      -> typed POST /api/coach/program-exercises/:programExerciseId/sets
      <- persisted PlannedSet
```

## No read REST endpoint

Opening `SetEntry` must not trigger a GET request. The parent passes a complete initialization object.

The initialization object contains the applicable subset of:

- optional program ID and display name (`null` / `null` for an own workout outside a program);
- exercise definition ID and display name;
- tracking type;
- set number;
- workout date/context;
- planned metrics for this exact set;
- the analogous set from the previous workout;
- existing FACT for the current set when it has already been recorded;
- stable plan/session identifiers needed by the active mode.

Program identity is an all-or-nothing pair: both `programId` and `programName` are populated, or both are `null`. When there is no program, the metadata line displays only the workout date.

## Previous-set invariant

`previous` means the same numbered set of the same exercise in the previous workout.

For example, when editing Bench Press set 3 today, `previous` is Bench Press set 3 from the previous workout. It is not set 2 from the current workout and it is not an arbitrary most-recent set.

The parent/backend projection resolves this meaning before rendering `SetEntry`. The component never queries history to derive it.

The line `Предыдущая тренировка: ...` is rendered in both `workout` and `plan` modes. Previous values are comparison context only and are never persisted as the new plan or FACT.

## PLAN / PREVIOUS / FACT

In `workout` mode:

- PLAN is the frozen session prescription and is read-only;
- PREVIOUS is read-only comparison context;
- FACT is the editable/persisted result;
- initial editable metrics follow `existing FACT -> PLAN -> empty metrics`;
- the visible `План: ...` line, set assessment, RPE, comment and fitness-band controls retain their existing workout behavior.

In `plan` mode:

- the values being entered are PLAN, so there is no separate `План: ...` line;
- PREVIOUS remains visible as read-only context;
- set assessment and RPE are not rendered because they are workout FACT fields;
- plan persistence writes only the planned metric columns supported by `program_set`.

A saved `program_set` remains mutable program prescription until workout start. When the client starts the corresponding program day, backend materialization copies the active `program_set` metrics into session-owned `session_set.planned_*` columns. From that point the workout reads the frozen session PLAN and later FACT changes do not rewrite the program prescription.

## Public React API

```ts
type SetEntryProps =
  | {
      mode?: 'workout';
      isOpen: boolean;
      data: SetEntryData;
      onClose: () => void;
      onSave: (fact: SetEntryFactDraft) => Promise<void>;
      onOpenHistory: () => void;
      onOpenChat: () => void;
    }
  | {
      mode: 'plan';
      isOpen: boolean;
      data: SetEntryData;
      programExerciseId: number;
      onClose: () => void;
      onOpenHistory: () => void;
      onOpenChat: () => void;
    };
```

`plan` is always explicit. The workout variant keeps omission as a backward-compatible default so existing direct consumers cannot silently break; production live-workout ownership is nevertheless explicit and `SessionExercise` passes `mode="workout"`. Coach program authoring passes `mode="plan"` plus the planned exercise parent ID.

The parent controls whether the dialog is open. `SetEntry` uses the shared UI Kit `Modal` and its `actions` contract for the Save action instead of rendering a parallel local confirmation button.

## UI Kit reuse

The module must prefer shared UI Kit primitives over local equivalents:

- `Modal` owns dialog behavior, close behavior and Save actions;
- `TextInput` is used for numeric inputs with `type="number"`, including unit labels (`КГ`, `ПОВТ.`, `КМ`, `МИН`, `СЕК`);
- `TextArea` owns the existing comment field;
- `Button`, `IconButton`, `Badge`, `Divider`, `Surface` and `Text` are reused for their corresponding roles;
- shared icon assets are reused for plus/minus and the Tabler `ripple` / `library` controls.

Custom controls remain only where the UI Kit has no matching interaction contract, notably the existing fitness-band color buttons and selectable badge wrappers. Plan mode does not introduce alternate UI Kit mechanics or visual variants.

## Tracking types

The component follows the existing Mezfit tracking contract:

- `weight_reps` -> weight + reps;
- `time` -> duration;
- `time_distance` -> duration + distance;
- `time_reps` -> duration + reps;
- `time_weight` -> duration + weight.

The component renders only fields relevant to the supplied tracking type.

## Save boundary

`SetEntry` does not use ad hoc `fetch`. Both modes use established typed boundaries.

### Workout mode

Pressing Save invokes the parent `onSave` with the complete editable FACT draft: actual metrics, set label, RPE, comment and selected fitness bands. The parent combines that FACT with stable session identity, calls the typed workout API and reconciles canonical session state.

This is the existing workout contract and must not change as a side effect of plan-mode work.

### Plan mode

Pressing Save calls the typed frontend planned-set API from `SetEntry` itself. The component supplies the `programExerciseId` parent identity and the authored metric values. The Worker authenticates the Telegram user, requires the coach role, verifies program ownership / active coach-client relationship, validates the payload and persists a new active `program_set` row.

The frontend never treats a supplied `programExerciseId` as authorization. D1 remains authoritative. `setNumber` is the one-based UI number and maps to zero-based `program_set.position`. Existing auxiliary controls are not part of the planned-set POST; only the tracking metrics become PLAN.

While either save is pending, the modal blocks closing, duplicate Save and edits to the submitted draft. On success the modal closes. On failure it stays open, re-enables editing and shows the error.

## Adjacent modules

`SessionExercise` is the direct UI parent for live workout use and always opens `SetEntry` in `workout` mode. It maps the already-projected session PLAN / PREVIOUS / FACT into `SetEntryData`.

Coach program authoring owns when a `plan` SetEntry is opened and supplies the planned exercise ID and already-resolved display/previous context.

Exercise history is a separate React module with its own data/API contract. `SetEntry` only emits `onOpenHistory`.

Telegram chat is owned by the Telegram/navigation integration. `SetEntry` only emits `onOpenChat`.

Workout start/resume/snapshot behavior belongs to the workout owner/backend. Plan-mode persistence must not mutate started session snapshots or live workout FACT.
