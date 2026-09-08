# Mezfit Product Concept

## Purpose

Mezfit is a Telegram Mini App ecosystem for fitness coaches and their clients, including remote coaching.

One Mini App exposes role-based interfaces:

- **Client mode** — execute assigned workouts, record actual results, inspect history and progress, and communicate with the coach.
- **Coach mode** — manage clients, build and edit client programs, assign workouts, inspect plan versus fact, review progress, and provide feedback.

Telegram is the communication layer. Text, voice, video, video notes, and photos should use native Telegram interaction where practical instead of rebuilding a parallel messenger inside the Mini App.

## Product principles

1. The coach's assignment is the source of the client's planned workout.
2. Plan and fact are separate domain concepts.
3. Historical completed workouts are immutable with respect to later program edits.
4. Coach mode is client-contextual: program editing, exercise selection, history, and load assignment operate in the context of a selected client.
5. Gym Keeper is a UX/feature reference for workout mechanics, not a source code, branding, or content template.
6. Gym Keeper built-in workout programs are not part of Mezfit. The client-facing program area represents the program assigned by the client's coach.

## Initial technical direction

The current direction is:

- Telegram Mini App frontend: React + TypeScript + Vite.
- Telegram Bot for entry points, notifications, and deep links.
- Backend/API required for shared coach/client state.
- Cloudflare Worker + D1/R2 is a candidate backend architecture to validate before implementation is fixed.

Avoid unnecessary frontend infrastructure during MVP; introduce additional state-management/UI frameworks only when justified by actual complexity.
