# SetEntry module contract

## Scope

`SetEntry` is the controlled React modal for viewing and editing one actual workout set. It is opened by the workout/exercise surface and does not load its own server state.

The module owns modal presentation and a local editable FACT draft. The parent/workout owner owns server state, API mutations, open/close state and reconciliation.

```text
Workout owner
  -> ExerciseCard
      -> SetEntry(isOpen, data, callbacks)
          -> local FACT draft
          -> onSave(fact)
      <- canonical server state after save
```

## No read REST endpoint

Opening `SetEntry` must not trigger a GET request. The parent passes a complete initialization object.

The initialization object contains:

- program ID and display name;
- exercise definition ID and display name;
- tracking type;
- set number;
- workout date;
- planned metrics for this exact set;
- the analogous set from the previous workout;
- existing FACT for the current set when it has already been recorded;
- stable plan/session set identifiers needed by the parent for persistence.

## Previous-set invariant

`previous` means the same numbered set of the same exercise in the previous workout.

For example, when editing Bench Press set 3 today, `previous` is Bench Press set 3 from the previous workout. It is not set 2 from the current workout and it is not an arbitrary most-recent set.

The parent/backend projection resolves this meaning before rendering `SetEntry`. The component never queries history to derive it.

## PLAN / PREVIOUS / FACT

`plan` is the coach prescription for this exact set and is read-only in `SetEntry`.

`previous` is read-only comparison context.

`fact` is the current persisted result when the set is reopened.

Initial editable metrics follow this precedence:

```text
existing FACT -> PLAN -> empty metrics
```

`previous` never replaces PLAN automatically.

## Public React API

```ts
interface SetEntryProps {
  isOpen: boolean;
  data: SetEntryData;
  onClose: () => void;
  onSave: (fact: SetEntryFactDraft) => Promise<void>;
  onOpenHistory: () => void;
  onOpenChat: () => void;
}
```

The parent controls whether the dialog is open. `SetEntry` uses the shared UI Kit `Modal` and its `actions` contract for the Save action instead of rendering a parallel local confirmation button.

The fitness-band picker is part of `SetEntry` because its selected values are part of the same unsaved FACT draft. Exercise history and Telegram chat are separate modules/integrations and are opened through callbacks.

## UI Kit reuse

The module must prefer shared UI Kit primitives over local equivalents:

- `Modal` owns dialog behavior, close behavior and Save actions;
- `TextInput` is used for numeric inputs with `type="number"`, including unit labels (`КГ`, `ПОВТ.`, `КМ`, `МИН`, `СЕК`);
- `TextArea` owns the comment field;
- `Button`, `IconButton`, `Badge`, `Divider`, `Surface` and `Text` are reused for their corresponding roles;
- shared icon assets are reused for plus/minus and the Tabler `ripple` / `library` controls.

Custom controls remain only where the UI Kit has no matching interaction contract, notably the multi-select fitness-band color buttons and selectable badge wrappers.

## Tracking types

The component follows the existing Mezfit tracking contract:

- `weight_reps` -> weight + reps;
- `time` -> duration;
- `time_distance` -> duration + distance;
- `time_reps` -> duration + reps;
- `time_weight` -> duration + weight.

The component renders only fields relevant to the supplied tracking type.

## Save boundary

`SetEntry` does not call `fetch` and does not know Worker routes, D1 or Telegram authentication.

Pressing the shared Modal Save action invokes `onSave` with the complete editable FACT draft:

- actual metrics;
- set label (`warmup`, `easy`, `normal`, `hard`, `drop`);
- RPE;
- comment;
- selected fitness bands.

While that promise is pending, the modal blocks closing, duplicate Save and edits to the submitted draft. On success the modal closes. Reopening creates a fresh draft from the parent's canonical `FACT -> PLAN -> empty` data, so a normalized server FACT cannot be overwritten later by the stale pre-save draft. On failure the modal stays open, re-enables editing and shows the error.

The parent/workout owner combines that FACT with stable identity from `SetEntryData`, invokes the typed frontend API client, then reconciles the canonical server response back into workout state.

PLAN, PREVIOUS and display strings are not user input and must not be sent back merely because the dialog displays them.

## Adjacent modules

Exercise history is a separate React module with its own data/API contract. `SetEntry` only emits `onOpenHistory`.

Telegram chat is owned by the Telegram/navigation integration. `SetEntry` only emits `onOpenChat`.

Workout start/resume/snapshot behavior is backend domain behavior triggered by the parent save operation. It is not an extra REST API owned by `SetEntry`.
