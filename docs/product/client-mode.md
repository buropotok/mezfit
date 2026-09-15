# Client Mode

## Purpose

Client mode minimizes friction between opening Mezfit and recording the workout. The primary workflow is:

`open Mini App → global workout FAB → start/continue workout → record sets → leave`.

Mezfit priority: **M**.

## Core views

```text
Today
Program
Exercises / exercise history where appropriate
Calendar
Progress
History
```

Today is primary; the exact MVP navigation may expose fewer destinations initially.

## Global workout FAB

The most important client action is a global workout FAB owned by the application/navigation shell rather than by an individual screen.

When there is no active `WorkoutSession`, the FAB is labelled `Начать тренировку` and is available across Client Mode destinations.

When an active `WorkoutSession` exists, the FAB is labelled `Продолжить тренировку` and navigates back to that session. It remains available across Client Mode except while the user is already on the current workout screen, where it is hidden.

The FAB is a single global entry point into the workout flow. Screen-specific modules must not create competing Start/Continue controls with independent state.

## Start workout flow

Starting a workout is explicit. Pressing the global FAB opens the workout screen immediately. The screen shows a blocking loader while the backend initializes or resumes the workout context.

The first request creates/reuses a minimal `WorkoutSession` draft and returns its generated session ID. The draft contains no materialized exercise children and no PLAN/PREVIOUS/FACT.

Program ambiguity belongs to the outer launch workflow. If multiple programs are active, the user explicitly chooses one before `WorkoutSessionScreen` receives its resolved program context; the session module does not silently pick a program.

For a resolved program, initialization returns the current phase and day choices. If exactly one workout day is unambiguously scheduled for the current date, it is preselected and the separate day-selection step may be skipped. Without a schedule override, the default is the next unfinished active day. The user still has access to:

- `Сменить день` — choose another active day from the resolved current phase;
- `Своя тренировка` — start a session outside the program.

Final Start is the second request. A program Start fresh-reads the selected day from the backend, materializes `session_exercise` / `session_set`, freezes PLAN and resolves PREVIOUS. An own-workout Start only activates the existing draft and does not request PLAN/PREVIOUS startup data.

## Program workout versus own workout

A program-based workout starts from a selected `program_day`. The backend snapshots/materializes its current prescription into the session domain at Start, immediately before execution begins.

A `Своя тренировка` is intentionally outside the program. It promotes the draft to an active `WorkoutSession` without a source program day. Exercises and sets are then added directly to the session and do not mutate the client's program.

Starting an own workout must remain possible even when the system has a scheduled program workout for the current date.

## Today and execution

Today shows the relevant planned workout context when available. During execution the primary representation is:

`Previous | Plan | Today`

Actual `SetResult` values never overwrite planned sets.

Once a program workout has started, execution reads PLAN from the session snapshot/materialized session data rather than from the mutable program.

## No mandatory Finish button

Explicit Finish may exist as a convenience, but correctness does not depend on it. Initial assumption: automatically complete after **60 minutes** without new workout activity. For timeout completion, `completed_at` reflects the last known workout activity rather than the later processing time.

## Manual workout time

Client and coach can manually enter/correct actual workout date/start/end time. This supports phones left at home/locker, paper notes and post-fact entry.

```text
started_at
completed_at
created_at
updated_at
```

Actual and technical timestamps remain distinct. Recommended provenance:

```text
start_time_source = AUTO | MANUAL
completion_source = EXPLICIT | TIMEOUT | MANUAL
```

## Post-fact entry

A completed workout may be entered later without forcing a visible live Start → Finish ritual. Historical/manual entry is a separate flow from the normal live-workout FAB lifecycle.

## Shared coach/client FACT

Actual results belong to the shared client workout session, not the device or role that entered them. Coach-entered in-person results and client-entered remote results converge on the same persisted `WorkoutSession`.

MVP does not require WebSockets. Refresh occurs on app load, foreground/resume, relevant navigation, manual refresh and successful mutations.

## Historical correction

Program edits never rewrite historical FACT. Authorized explicit correction of an incorrectly entered result is allowed and must retain audit metadata.
