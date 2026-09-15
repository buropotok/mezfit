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

Entering the workout launch flow immediately creates or reuses one minimal `WorkoutSession` draft and returns its generated session ID. Initialization is idempotent and does not materialize exercises or return PLAN/PREVIOUS/FACT.

The outer launch workflow resolves program ambiguity before the session module: when multiple programs are active, the user must explicitly choose one; the workout session component must not silently select an active program.

For a resolved program context:

- one unambiguous scheduled `program_day` → preselect it and skip the separate day chooser;
- `Сменить день` → choose another active day from the resolved current phase;
- `Своя тренировка` → start outside the program;
- without an explicit schedule override, the default is the next unfinished active day.

A scheduled day is only the default. Even when the chooser is skipped, `Сменить день` and `Своя тренировка` remain available while the session is still `draft`.

Final Start promotes the existing draft to an active session. For a program workout, the backend fresh-reads the selected day at Start, materializes session-owned exercises/sets, resolves PREVIOUS and freezes PLAN there. From that point the active session reads PLAN from session data, not from the mutable program.

`Своя тренировка` promotes the draft without a source program day and without PLAN/PREVIOUS children, and must not mutate the assigned program.
