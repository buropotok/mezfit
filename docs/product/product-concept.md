# Mezfit Product Concept

## Purpose

Mezfit is a Telegram Mini App workspace for fitness coaches and their clients. It supports both remote coaching and in-person personal training.

The core product loop is:

`coach plans → client/coach records actual performance → coach reviews plan vs fact → coach adjusts future prescription`.

One Mini App exposes role-based interfaces:

- **Client mode** — view the assigned program, execute workouts, record actual results, inspect exercise history and progress, and communicate through Telegram.
- **Coach mode** — manage clients, analyze a selected client, build and edit future prescriptions, record workout results during in-person sessions, inspect plan versus fact, and review progress.

Telegram is the communication layer. Text, voice, video, video notes, and photos should use native Telegram interaction where practical instead of rebuilding a parallel messenger inside the Mini App.

## Product principles

1. **The coach owns prescription; plan and fact are separate.** A planned set is never overwritten by the actual result.
2. **Fact is shared data.** Actual workout results may be recorded by either the client or the coach. Both roles operate on the same `WorkoutSession` and see the same persisted results after refresh/reload.
3. **Coach mode is client-contextual.** The selected client is the primary workspace. Analysis and editing should stay in that context.
4. **Analytics should lead directly to action.** Where the coach sees information that naturally implies a prescription change, future-plan editing should be reachable in one transition.
5. **Exercise history is a first-class client view.** The coach must be able to open Exercises directly from the client workspace and access every exercise ever actually performed by that client, independently of the current program.
6. **A workout plan becomes immutable when that specific workout starts.** Start is detected by the first persisted actual result. Only that `WorkoutOccurrence` is locked; other future occurrences remain editable.
7. **No in-workout plan overrides.** Once a workout is in progress, its plan snapshot cannot be changed by either role. Differences between plan and what is performed are recorded as FACT.
8. **Program edits never rewrite workout history.** Completed and in-progress sessions retain the plan snapshot used for that session.
9. **Historical FACT may be explicitly corrected.** Authorized client/coach corrections are distinct from program edits and should be auditable.
10. **Start/finish controls are not required for correctness.** The first result starts a session automatically. Explicit Finish is optional; inactivity can auto-complete the session.
11. **Actual workout time is editable.** Client or coach may manually enter `started_at` and `completed_at`, including recording an entire workout after the fact. Technical `created_at/updated_at` remain separate.
12. **Offline/post-fact entry accepts a known plan-version risk.** If the client trained without the app while the coach changed the plan, MVP does not reconstruct which plan the client physically saw.
13. **Backend state is the source of truth.** WebSockets are not required for MVP; current shared state is refreshed on app load, foreground/resume, relevant navigation, manual refresh, and after mutations.
14. **Gym Keeper is a UX/feature reference only.** Its source code, branding, proprietary media, built-in programs, and local Diary-centric product model are not Mezfit product requirements.
15. **Gym Keeper built-in workout programs are excluded.** Client-facing Program means the prescription assigned by the client's coach.

## Core domain translation from Gym Keeper

```text
Gym Keeper                 Mezfit
Diary                      CoachClient context
Program                    ProgramAssignment / prescription
Day                        Schedule + WorkoutOccurrence
Workout                    WorkoutDefinition + WorkoutSession
Exercise                   ExerciseDefinition + PlannedExercise + ExerciseResult
Set                        PlannedSet + SetResult
Previous / History         client-specific exercise/workout history
Stats / Measures           client Progress
Comment                    coach instruction / client note / Telegram feedback reference
```

## Initial technical direction

The current direction is:

- Telegram Mini App frontend: React + TypeScript + Vite.
- Telegram Bot for entry points, notifications, and deep links.
- Backend/API required for shared coach/client state.
- Cloudflare Worker + D1/R2 is a candidate backend architecture to validate before implementation is fixed.

Avoid unnecessary frontend infrastructure during MVP; introduce additional state-management/UI frameworks only when justified by actual complexity.
