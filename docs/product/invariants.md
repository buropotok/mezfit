# Mezfit product invariants

Status: **canonical**. These rules apply to all subsequent product/UI implementation unless a later product decision explicitly changes them.

## 1. User-facing language

**All user-facing Mezfit UI is Russian.**

This includes:
- navigation and screen titles;
- buttons, menus, filters, badges and selectors;
- loading, empty, validation and error messages;
- exercise/program/workout labels and metadata shown by the product;
- bundled catalogue display names.

Technical/internal identifiers may remain English where appropriate: database column names, API fields, enum codes, source resource names, APK reference keys and implementation symbols.

User-authored content is preserved as entered; the invariant applies to product-owned copy and bundled product data.

## 2. Gym Keeper parity for existing fitness flows

When a fitness flow exists in the supplied Gym Keeper reference APK, Mezfit reproduces its functional flow and information architecture as closely as the Telegram Mini App platform permits.

Do not flatten, reorder or redesign a referenced Gym Keeper flow merely because a different web UI would be easier to implement. A deviation requires one of these reasons to be documented in the implementation PR:
- Telegram platform constraint/convention;
- Mezfit domain/data-integrity invariant;
- explicit product-owner decision.

For exercise catalogue behavior this means category-first navigation, Gym Keeper-style filter chips/list density and row context actions are reference behavior, not optional decoration.

## 3. Mezfit coach/client adaptations are explicit

Gym Keeper is primarily a single-user diary. When Mezfit adds coach/client targeting, the minimum extra targeting step is added explicitly without changing unrelated Gym Keeper catalogue behavior. For example, assigning an exercise requires explicit client and editable day/workout selection; the global catalogue must not guess either target.

## 4. Workout launch is global, explicit and session-first

Client Mode has one canonical global workout FAB owned by the application/navigation shell.

- no active session → `Начать тренировку`;
- active session outside its workout screen → `Продолжить тренировку`;
- current active workout screen → FAB hidden.

Normal live workout execution requires explicit Start. The first saved set is not the workout-start event.

Before creating the session, the launcher resolves the source workout:

- one unambiguous scheduled `program_day` → preselect it and skip the separate day chooser;
- `Сменить день` → choose another day from the current phase;
- `Своя тренировка` → start outside the program;
- no unambiguous scheduled day → show current-phase day choices plus `Своя тренировка`.

A scheduled day is only the default. Even when the chooser is skipped, `Сменить день` and `Своя тренировка` remain available before final Start confirmation.

Only final Start creates the `WorkoutSession`. For a program workout, the selected day is materialized into session-owned exercises/sets and its PLAN is frozen there. From that point the active session reads PLAN from session data, not from the mutable program.

`Своя тренировка` creates a session without a source program day and must not mutate the assigned program.
