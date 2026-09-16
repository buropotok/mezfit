# SetEntry module contract

## Scope

`SetEntry` is the shared controlled React modal for one set and has two explicit domain modes:

- `workout` edits the actual FACT of a live workout set;
- `plan` lets a coach create the PLAN for a program exercise.

Opening either mode does not load server state. The parent passes the complete initialization object, including the analogous previous-workout set.

```text
Workout owner -> SetEntry(mode="workout") -> local FACT draft -> onSave(fact)
Coach program authoring -> SetEntry(mode="plan") -> local PLAN draft -> typed POST -> program_set
```

## No read REST endpoint

Opening `SetEntry` must not trigger a GET request. The parent passes a complete initialization object.

The initialization object contains:

- optional program ID and display name (`null` / `null` for an own workout outside a program);
- exercise definition ID and display name;
- tracking type;
- set number;
- workout date/context label;
- planned metrics when they already exist;
- the analogous set from the previous workout;
- existing FACT for workout mode when it has already been recorded;
- stable plan/session identifiers required by the active mode.

Program identity is an all-or-nothing pair: both `programId` and `programName` are populated, or both are `null`.

## Previous-set invariant

`previous` means the same numbered set of the same exercise in the previous workout.

For example, when editing Bench Press set 3, `previous` is Bench Press set 3 from the previous workout. It is not set 2 from the current workout and it is not an arbitrary most-recent set.

The parent/backend projection resolves this meaning before rendering `SetEntry`. The component never queries history to derive it. `previous` is passed and displayed in both `workout` and `plan` modes as `Предыдущая тренировка: ...` so the athlete or coach has comparison context.

## PLAN / PREVIOUS / FACT

In `workout` mode, `plan` is the read-only coach prescription for this exact set, `previous` is read-only comparison context, and `fact` is the current persisted result. Initial editable metrics follow:

```text
existing FACT -> PLAN -> empty metrics
```

In `plan` mode, the editable metrics themselves are the PLAN being authored. Therefore the separate `План: ...` comparison row is not rendered. `previous` remains visible and never replaces PLAN automatically.

## Public React API

`mode` is a discriminant, not a collection of presentation flags:

```ts
type SetEntryProps =
  | {
      mode: 'workout';
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

The parent controls whether the dialog is open. `SetEntry` uses the shared UI Kit `Modal` and its `actions` contract for Save.

## Mode-specific presentation

`workout` preserves the existing card behavior, including the read-only `План: ...` row, `Предыдущая тренировка: ...`, `Оценка подхода`, RPE and workout FACT controls.

`plan` is coach-only. It keeps `Предыдущая тренировка: ...` visible, because previous performance is useful context while prescribing the next set. It does not render the separate `План: ...` row because the editable values are the plan. It also does not render `Оценка подхода` or RPE, because those are workout FACT attributes rather than prescription attributes.

## UI Kit reuse

The module must prefer shared UI Kit primitives over local equivalents:

- `Modal` owns dialog behavior, close behavior and Save actions;
- `TextInput` is used for numeric inputs with `type="number"`, including unit labels (`КГ`, `ПОВТ.`, `КМ`, `МИН`, `СЕК`);
- `TextArea` owns the workout comment field;
- `Button`, `IconButton`, `Badge`, `Divider`, `Surface` and `Text` are reused for their corresponding roles;
- shared icon assets are reused for plus/minus and the Tabler `ripple` / `library` controls.

Custom controls remain only where the UI Kit has no matching interaction contract, notably the multi-select fitness-band color buttons and selectable badge wrappers. The two modes do not fork or restyle UI Kit primitives.

## Tracking types

The component follows the existing Mezfit tracking contract:

- `weight_reps` -> weight + reps;
- `time` -> duration;
- `time_distance` -> duration + distance;
- `time_reps` -> duration + reps;
- `time_weight` -> duration + weight.

The component renders only fields relevant to the supplied tracking type.

## Save boundary

`SetEntry` never performs ad-hoc `fetch`; all HTTP transport goes through the typed frontend API client.

In `workout`, the existing ownership remains unchanged. Save invokes `onSave` with the complete editable FACT draft. The workout owner combines it with stable session identity, performs its mutation and reconciles canonical server state.

In `plan`, Save is intentionally owned by `SetEntry`: it calls the typed `createCoachProgramSet` API operation with `programExerciseId` as the parent identity and the authored set number/metrics. The Worker authenticates the current Telegram user, requires the coach role, resolves the program exercise through its program hierarchy, verifies coach ownership and any active coach-client relationship, validates the metrics, and inserts `program_set`. Frontend possession of a `programExerciseId` is never authorization.

The existing D1 `program_set` schema already stores the required prescription metrics, so this change does not require a migration. A later workout start/materialization step turns persisted `program_set` values into the session-owned PLAN snapshot; started workout FACT does not mutate the program prescription.

While either save operation is pending, the modal blocks closing and duplicate Save. On success it closes. On failure it remains open, re-enables editing and shows the error.

## Adjacent modules

`SessionExercise` is the direct UI parent for live workout use and always opens `SetEntry` with `mode="workout"`.

Coach-side program authoring is the only valid caller of `mode="plan"`. It must provide the stable `programExerciseId` plus already-projected previous-set context. Backend authorization still determines whether that program exercise is mutable by the current coach.

Exercise history and Telegram chat remain separate modules/integrations opened through callbacks. Workout start/resume/snapshot behavior belongs to the workout owner/backend rather than `SetEntry`.
