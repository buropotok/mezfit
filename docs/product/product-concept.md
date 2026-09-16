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
2. **Fact is shared data.** Actual workout results may be recorded by either the client or the coach. Both roles operate on the same `WorkoutSession`.
3. **Coach mode is client-contextual.** The selected client is the primary workspace.
4. **Analytics should lead directly to action.** Future-plan editing should be reachable directly from relevant analysis.
5. **Exercise history is a first-class client view.** `Exercises` is directly reachable and includes every exercise ever actually performed by that client, independently of the current program.
6. **A workout plan becomes immutable when that specific workout explicitly starts.** Entering the launch flow creates/reuses a minimal draft `WorkoutSession` ID, but PLAN is not materialized until final Start. Program Start fresh-reads and freezes/materializes PLAN for that session. Only that started workout is locked; other future occurrences remain editable.
7. **No in-workout plan overrides.** Differences between prescription and execution are PLAN versus FACT, not a rewritten plan.
8. **Program edits never rewrite workout history.** Started/completed sessions keep the plan snapshot used for that session.
9. **Historical FACT may be explicitly corrected.** Authorized corrections are separate from program edits and must remain auditable.
10. **Normal live execution requires explicit Start; explicit Finish is optional.** The first result does not start a session. Inactivity may auto-complete an already-started session.
11. **Actual workout time is editable.** Client or coach may manually enter `started_at` and `completed_at`, including post-fact entry. `created_at/updated_at` remain technical timestamps.
12. **Offline/post-fact entry accepts a known plan-version risk.** MVP does not reconstruct which plan the client physically saw while offline.
13. **Backend state is the source of truth.** WebSockets are not required for MVP; state refreshes on load/resume/navigation/manual refresh/mutations.
14. **Reliability beats complexity in ambiguous MVP cases.** Prefer a deterministic restriction or reversible simplification over fragile behavior.
15. **Gym Keeper is a UX/feature reference only.** Its code, branding, proprietary media, built-in programs, and Diary-centric product model are not Mezfit requirements.
16. **Gym Keeper built-in workout programs are excluded.** Client-facing Program means the prescription assigned by the client's coach.
17. **Workout launch is a global Client Mode action.** A shell-owned FAB exposes `Начать тренировку` when no session is active and `Продолжить тренировку` when one is active; it is hidden only on the current active workout screen.
18. **A scheduled workout is the default, not a trap.** An unambiguous scheduled day may be preselected and skip the day chooser, but while the session is still `draft` the client can always use `Сменить день` or `Своя тренировка`. Multiple active programs are resolved explicitly by the outer launch workflow rather than guessed inside the session module.
19. **Own workouts do not mutate the program.** `Своя тренировка` promotes the draft without a source program day and without PLAN/PREVIOUS startup data; exercises and sets added there belong to the session only.

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

## Technical baseline

Validated implementation baseline:

- Telegram Mini App frontend: React + TypeScript + Vite.
- Telegram Bot: `@mezfit_bot`.
- Backend/API: Cloudflare Worker `mezfit`.
- Persistence: D1 binding `DB_BINDING`.
- Media storage: private R2 binding `R2_BINDING_MEZFIT`.
- Telegram auth: server-side validation of signed Mini App `initData`.
- CI/CD: GitHub Actions → tests/typecheck/build → D1 migrations → Wrangler deploy.

For framework behavior and platform integration, prefer current official React, Cloudflare, TypeScript/Vite and Telegram documentation over custom conventions. Avoid additional frontend infrastructure until an actual product constraint justifies it.
