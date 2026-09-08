# Client Mode

## Purpose

Client mode minimizes friction between opening Mezfit and recording the workout. The client should not have to understand internal scheduling/session concepts.

Primary workflow:

`open Mini App → Today → record sets → leave`.

Mezfit priority: **M**.

## Core client views

Current product direction:

```text
Today
Program
Exercises / exercise history access where appropriate
Calendar
Progress
History
```

The exact MVP bottom navigation may expose fewer top-level items, but Today is primary.

## Today

Today shows the relevant `WorkoutOccurrence` and its current state.

Before any result is recorded, the client sees the current editable server-side prescription for that scheduled occurrence.

During execution, the primary pattern is:

```text
Previous | Plan | Today
```

The client records actual `SetResult` values without overwriting the planned set.

## No mandatory Start button

Mezfit does not require the user to press “Start workout.”

The first persisted actual result starts the workout from the system's perspective. In one backend transaction the system should:

1. create/resolve the `WorkoutSession`;
2. freeze the occurrence's plan snapshot;
3. mark the occurrence/session `IN_PROGRESS`;
4. persist the first result;
5. assign automatic `started_at` if no manual value exists.

This removes a workflow step that users commonly skip.

## No mandatory Finish button

An explicit Finish action may exist as a convenience, but correctness must not depend on the user pressing it.

If the user leaves after the final set, the session can be auto-completed after an inactivity timeout. Initial product assumption: **60 minutes** after the last recorded result; validate with real use.

For automatic completion, `completed_at` should represent the last known workout activity/result time rather than the later moment when the server notices the timeout.

## Manual workout time

Client must be able to manually enter or correct the actual workout date/start/end time.

This supports common real-world cases:

- phone left at home or in a locker;
- results written in a notebook;
- workout entered into Mezfit later;
- incorrect automatically inferred time.

Keep actual and technical timestamps distinct:

```text
started_at
completed_at

created_at
updated_at
```

Recommended provenance metadata:

```text
start_time_source = AUTO | MANUAL
completion_source = EXPLICIT | TIMEOUT | MANUAL
```

Manual actual time has precedence over automatic inference.

Mezfit priority: **M**.

## Post-fact workout entry

A client may enter an already completed workout later. The product must not force such a workout through a visible Start → Finish ritual.

The user can enter actual start/end times and results from notes.

Known limitation accepted for MVP: while the client was physically training offline, the coach may have changed the server-side plan because Mezfit had no `IN_PROGRESS` signal. Mezfit does not attempt to reconstruct which plan version the client physically saw. When results are first persisted, the server freezes the plan state available to it at that moment.

## Shared coach/client FACT

Actual results belong to the shared client workout session, not to the device or role that entered them.

If the coach records results during an in-person session, the client sees those results on the next load/refresh. If the client records results, the coach sees the same persisted state.

MVP does not require WebSockets. Refresh should occur on:

- Mini App load;
- returning to foreground;
- opening Today/relevant workout;
- manual refresh;
- successful mutation.

## Historical correction

Program edits must never rewrite historical FACT. However, authorized explicit correction of an incorrectly entered result is allowed and should retain audit metadata.
