# Quick workout planning

The calendar FAB opens the shared planning application service in
`src/data/cloud/workout-planning.ts`. Program-day planning uses the same slot
suggestion. Suggestions remain 60 minutes, rounded to 15 minutes within the
existing 08:00–22:00 search. All authorized locally available participant bookings,
including drafts, are checked independently of the visible calendar filter.

A blank workout can omit both `trainingPlanId` and `programDayId`. These fields
are provenance, not authorization. The occurrence still has its complete PLAN,
athlete, relationship/personal realm and explicit format. No source records or
synthetic IDs are created merely to satisfy the calendar renderer.

When no authorable program exists in the selected personal or coach-client
scope, blank creation atomically creates “Программа тренировок”, the normal
“Фаза 1” (the existing default duration), a “Тренировка” day and the occurrence.
Program and phase stay Draft. This blank-authoring path deliberately does not
require Active source statuses; ordinary planning from an existing day still does.
The immutable `autoCreatedProgram` provenance flag identifies this special first
publication. First publication atomically fills that day from the accepted local
PLAN and records a publication baseline. Subsequent edits are independent. A
locally changed/deleted target is reported without discarding the workout draft.

“Добавить в программу” copies current accepted PLAN to an authorable program of
the same athlete. New-day mode selects program/phase; replace mode also selects
a day and confirms replacement. Nested Badges is composed through its public
`info` slot; the primitive is unchanged. Replacement checks the selected day
snapshot locally before writing. The operation preserves occurrence timing,
publication, provenance, session state and history. Program sets receive structure,
labels, notes and links, with numeric prescription values cleared. FACT export
from sessions is intentionally outside this feature.

All operations commit locally through repositories. Addon eagerly replicates
drafts and published occurrences. No HTTP, cloud wait, role/schema installer or
new synchronization mechanism is introduced. No indexes change, so no IndexedDB
version change is required. The existing reviewed Coach PLAN manage and calendar
add/update permissions cover the writes; `autoCreatedProgram` is added only at
occurrence creation and is never updated.

The search icon below the week selector opens the existing multiple-client
filter sheet. Creation chooses one athlete separately. Independent client
planning selects that client's calendar; own/coached planning restores the main
coach calendar. The event sheet is a UI placeholder and creates no records.
