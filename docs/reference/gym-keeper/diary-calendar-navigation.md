# Gym Keeper Diary, Calendar and Navigation

This document records static APK findings from `com.kg.app.sportdiary` and separates observed behavior from Mezfit product interpretation.

## Observed

### Diary is a first-class container

DEX/resource evidence includes:

- Realm model `Diary`;
- `currentDiaryId` / `getCurrentDiaryId` / `setCurrentDiaryId`;
- `diary_create`, `diary_edit`, `diary_delete`, `diary_current`;
- `dialog_edit_diary.xml`, `li_diary.xml`;
- Diary import/export support documented separately.

This strongly indicates that Gym Keeper can maintain multiple diaries and one diary is selected as the current working context.

### Date-oriented main workflow

The APK contains:

- `CompactCalendarView` and its complete calendar rendering dependency;
- `l_calendar.xml`;
- `fragment_day.xml`;
- `l_day_header.xml`;
- `dialog_view_day.xml`;
- `mi_calendar`, `mi_today`, `ic_today`, `v_today`;
- Realm `Day.epochDay` accessors;
- `getDays`, `getDaysPast`, `getDaysPeriod`;
- `workoutsDatesLastStr` setting/cache field.

This establishes a strong date/day-centric navigation model: a selected date resolves a Day and its workouts.

### Day editing

Resources/strings include:

- `dialog_edit_day_comment.xml`;
- `day_delete`, `day_delete_warning`, `day_deleted`;
- `hint_day_comment`;
- `choose_day_to_copy_exercises`;
- copy/add workflows from another day/workout.

A day is therefore more than a calendar marker: it is an editable workout container with comments and reusable exercise/workout content.

### Workout inside a day

Relevant resources include:

- `dialog_edit_workout.xml`;
- `li_workout.xml`;
- `dialog_workout_exercise_sets.xml`;
- workout duration modes `workout_time_auto`, `workout_time_manual`, `workout_time_auto_explained`.

Combined with Realm models `Diary -> Day -> Workout -> Exercise -> Set`, the observed hierarchy is consistent with a personal training diary organized primarily by date.

### Main navigation/actions

Static resources include:

- `activity_main.xml`;
- `menu_activity_main.xml`;
- `menu_activity_main_more.xml`;
- `li_main_menu.xml`;
- actions `mi_home`, `mi_calendar`, `mi_today`, `mi_timer`, `mi_info`, `mi_more`;
- separate `StatsActivity`, `NotebookActivity`, `SettingsActivity`, `CalcsActivity`.

The APK also exposes `open_stats_general`, `open_notebook`, and related activity resources.

This is consistent with a central diary/day screen plus utility destinations rather than a coach/client workflow.

## Inferred Gym Keeper navigation model

The static evidence supports approximately:

```text
Current Diary
    |
    +-- Today / selected calendar date
    |      |
    |      +-- Day
    |             +-- day comment
    |             +-- Workout(s)
    |                    +-- Exercise(s)
    |                           +-- Set(s)
    |
    +-- Calendar/date navigation
    +-- Statistics
    +-- Notebook
    +-- Timer
    +-- Settings / utilities
```

The exact runtime screen transitions still require dynamic observation or deeper decompilation, but the container hierarchy and calendar/day affordances are directly supported by APK evidence.

## Mezfit product interpretation

Gym Keeper's navigation should not be copied literally because its primary actor is a person keeping their own diary. Mezfit has two actors and a coach-owned plan.

### Client mode

The primary destination should be **Today**, not Calendar.

Proposed information architecture:

```text
Today
My Program
Calendar / History
Progress
```

`Today` answers one question immediately: what has my coach assigned now, and can I start/resume it?

Calendar remains useful as a secondary temporal view:

- future date -> scheduled occurrence / planned workout;
- today -> start/resume current occurrence;
- past date -> completed workout or non-completion state;
- postponed/cancelled occurrences remain explicit scheduling facts.

**Mezfit priority: M — Today/current workout entry point.** It is the main client loop.

**Mezfit priority: S — Calendar/history date navigation.** Important for context and schedule management, but not the primary client action.

### Coach mode

The equivalent of Gym Keeper's `currentDiaryId` should not become a generic diary selector. The coach's persistent working context is the selected client.

Proposed information architecture:

```text
Clients
  -> Selected Client
       Overview
       Program
       Calendar
       Progress
       History
```

This keeps program editing, scheduling, exercise history and load assignment scoped to one client.

**Mezfit priority: M — persistent selected-client context.** Without it coach-side actions are ambiguous.

**Mezfit priority: M — client Program area.** This is the source of future planned workouts.

**Mezfit priority: S — client Calendar.** Useful for scheduling, postponement and plan-vs-fact temporal review.

**Mezfit priority: S — client Progress/History destinations.** Required for effective ongoing coaching, but can follow the first executable plan flow.

### Diary concept

Gym Keeper's multiple personal diaries are not a useful top-level Mezfit concept. Mezfit already has explicit CoachClient and ProgramAssignment context.

**Mezfit priority: W — generic user-created Diary containers.** Do not reproduce them. Their useful responsibilities are represented by client relationships, program assignments, workout occurrences and sessions.

### Day comments / notebook

A generic day comment and global notebook are less precise than Mezfit's contextual notes/feedback.

Prefer:

- coach instruction on planned exercise/workout;
- client note on actual result/session;
- Telegram-linked feedback thread;
- optional scheduling note/reason on occurrence.

**Mezfit priority: W — generic standalone Notebook clone.** Contextual notes and Telegram communication are more useful.

**Mezfit priority: S — contextual coach/client notes.** They support remote coaching directly.

### Workout duration modes

Gym Keeper supports automatic/manual workout-time behavior. Mezfit can initially derive duration from `started_at` / `completed_at` and allow later correction only if evidence shows it is needed.

**Mezfit priority: C — manual workout-duration correction.** Not required for the core coaching loop.

## Architecture implications

The APK analysis reinforces the existing Mezfit separation:

```text
ProgramAssignment
    -> Schedule
    -> WorkoutOccurrence (date/scheduling fact)
    -> WorkoutSession (actual execution)
```

Do not collapse Calendar/Day into WorkoutSession. A future calendar item exists before an execution session, while historical execution must preserve its immutable plan snapshot.

The client Today API should therefore resolve something close to:

```text
TodayState
- occurrence
- effective planned workout
- active session, if already started
- previous performance context
```

The coach selected-client overview should resolve scheduling state without manufacturing empty WorkoutSessions.

## Backlog impact

Already covered by existing backlog:

- coach/client context — Issue #2;
- coach program editor — Issue #3;
- scheduling and WorkoutOccurrence — Issue #5;
- client Today execution — Issue #6;
- immutable plan/fact — Issue #7;
- history / plan-vs-fact — Issue #12.

A dedicated calendar UX task is justified because the current scheduling issue is primarily domain/lifecycle oriented and does not specify the client/coach temporal navigation surface.