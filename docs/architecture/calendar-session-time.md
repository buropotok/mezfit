# Actual session time in the calendar

Scheduled UTC start/duration remain unchanged in workoutOccurrences. Calendar
execution headers come from an authorized AdHocWorkoutRepository projection,
including completed history and shared Client read access. No migration, new
index, cloud permission, business-data rewrite or physical deletion is required.

The timeline shows a linked session in place of its scheduled occurrence, on the
actual local dates derived from session.startedAt. Matching checks the occurrence
ID, realm, participants and existing session link. Quick/program sessions appear
without requiring a new scheduled occurrence. Cancelled-only mode excludes
sessions. Current date and Client filters apply to both kinds of records.

Active geometry ends at current device time and refreshes every 15 seconds and
on WebView visibility changes. Completion freezes the end at completedAt. A
quarter-hour minimum in DaySchedule geometry keeps short and newly started cards
readable. This does not change durationMinutes, saved timestamps, segmentation
or resource occupancy. Zero-length Start has one segment on its actual date;
near midnight the minimum frame stays inside that date. Active labels use
«start–…», not the current time as a completed end. Multi-day and offset-transition segmentation reuses the
calendar's existing timezone logic. Session overlap with the next scheduled
booking is accepted; session drag/resize/delete interactions are disabled.

Opening a session uses its exact ID in a calendar Bottom Sheet. Coach capabilities
and Client read-only behavior are preserved. Original scheduled date/time remains
available as a separate reference in the session card and started PLAN editor.
Session observation derives that reference from an authorized, matching occurrence;
it never overwrites actual timestamps or the original schedule.

PLAN and FACT card headers show the athlete, separately from author/provenance.
The athlete name is above the training format. Started/completed records show
«Запущена»/«Завершена». Reusable program day templates have no execution status.
The expanded occurrence card puts its menu to the left of its collapse chevron;
the menu is absent when collapsed. Collapse remains local to the card.

Timeline EventCard composition is separate from detailed PLAN/FACT cards: a
fixed-size athlete avatar occupies the left media slot; the training-format icon
occupies the right corner. Compact cards hide the avatar entirely and show one
Caption row: day, athlete, actual time, status and icon. Only the icon may shrink.
PLAN/FACT keep their upper-right athlete avatar. Active detailed cards show an
open end until completion, without substituting now into completedAt.

Start materializes only the selected occurrence. Calendar reads project all
authorized execution history, so deployment of actual-time projection can change
old cards compared with their former planned durations. A live clock refresh is
not a persistent edit. Regression coverage compares both stored records and
display intervals for unrelated coach/client history and future bookings across
another planned Start and clock advancement.

Checks cover actual/complete intervals, preservation of original timing,
authorized history, replacement rather than duplication, unplanned executions,
active refresh/completion, overlap, athlete identity and menu placement. Physical
mobile visual validation and GitHub CI remain separate from source review.
