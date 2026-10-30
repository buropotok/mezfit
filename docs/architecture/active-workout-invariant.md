# One unfinished activity per athlete

Product requirement confirmed on 2026-10-30: an athlete must finish their current
activity before starting another, regardless of its creator, program or format.
Client Training has one current session, without an active-session switcher.
Existing duplicate sessions are not deleted, merged or completed automatically.

Start rejection messages:

| Viewer | Current activity | Message |
| --- | --- | --- |
| Coach | From this Coach's program | В текущий момент у атлета незавершённая активность, перейдите в разделе Клиент/Тренировка. |
| Coach | Other activity | В текущий момент у атлета незавершённая активность. |
| Client | Any activity | Завершите текущую тренировку, чтобы начать новую. |

Client/Training is a future Coach section. This change supplies the message only;
it does not create that section or a navigation action.

## Current enforcement and limits

`AdHocWorkoutRepository` checks authorized local active session rows by
`athleteUserId` in the same read/write transaction as Start. Quick, program and
occurrence starts share the check. A Coach-program activity is identified by its
immutable program provenance and matching `coachUserId`. The existing restriction
on another current workout created by the Coach remains in place. Reopening the
same active occurrence remains idempotent. A rejected Start neither converts the
format nor creates a program, session or execution children.

This is local business validation, not a cross-device global lock. The Coach's
replicated subset does not include the athlete's private personal realm or
another Coach's relationship realm. It cannot detect activities absent from that
subset, and two disconnected devices cannot coordinate independent starts.
No private realm reads, extra permissions, server business lock, presence table
or custom replication protocol are introduced by this fix. Full enforcement for
private activities requires a separate approved minimal activity-visibility
contract; strict cross-device uniqueness also needs an explicit decision about
offline Start. Do not claim these guarantees from this local fix or its tests.
