# Client Mode

## Purpose

Client mode minimizes friction between opening Mezfit and recording the workout. The primary workflow is:

`open Mini App → Today → record sets → leave`.

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

## Today and execution

Today shows the relevant `WorkoutOccurrence`. During execution the primary representation is:

`Previous | Plan | Today`

Actual `SetResult` values never overwrite planned sets.

## No mandatory Start button

The first persisted actual result is the system-known workout start. The backend atomically creates/resolves `WorkoutSession`, freezes the occurrence plan snapshot, transitions to `IN_PROGRESS`, persists the result and sets automatic `started_at` if needed.

Both client and coach can trigger this by recording FACT.

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

A completed workout may be entered later without forcing a visible Start → Finish ritual. MVP accepts that a coach may have changed the server-side plan while the client was physically training offline; Mezfit does not attempt to reconstruct which plan version the client physically saw.

## Shared coach/client FACT

Actual results belong to the shared client workout session, not the device or role that entered them. Coach-entered in-person results and client-entered remote results converge on the same persisted `WorkoutSession`.

MVP does not require WebSockets. Refresh occurs on app load, foreground/resume, relevant navigation, manual refresh and successful mutations.

## Historical correction

Program edits never rewrite historical FACT. Authorized explicit correction of an incorrectly entered result is allowed and must retain audit metadata.
