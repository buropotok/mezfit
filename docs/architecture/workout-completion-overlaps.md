# Review planned overlaps after explicit workout completion

This slice applies only to a Coach pressing Finish in the workout screen or the
calendar session sheet. Save completion first. Then query authorized local PLAN
rows intersecting the actual session interval. Opening history, reading a completed
session, synchronization and timers never trigger the sheet.

The sheet uses collapsed workout headers and the agreed explanatory text. One
card at a time expands actions under its header, moving the following cards.
Cancel uses existing cancellation; Move uses existing date/time pickers, retains
duration and PLAN/publication, and rejects occupied slots or a remaining overlap
with the completed session. Keep removes the item only from the current review.
Closing does not mutate bookings. After all items leave the list, close the sheet.
There are no automatic reminders, system messages, counters on cards or new
persisted review-status records in this slice. Undecided PLAN rows remain intact
for the future system-message feature; that feature will define durable review
decisions separately.

Use actual start/end, half-open intervals and shared participant rules. Exclude
the linked source occurrence, personal events, drafts, cancellations, inactive
records and any occurrence already linked to execution (even if its status is
stale). An independent workout of another athlete does not occupy the Coach.
The same athlete's independent booking can overlap. Live local reads remove
externally cancelled/moved/started rows and revalidate access at mutation time.

The review owner lives above the active session screen, which may disappear on
completion. It does not delay or roll back completion. Back/X can dismiss; actions
lock briefly while a write runs. Failed writes retain the card and show a bottom
toast. Failed reads leave completion usable and offer an explicit toast retry.
Changing destination/account/role invalidates old callbacks and subscriptions.
The template-save question yields to the overlap review.

No schema, ACL, Worker, source PLAN or FACT changes. Existing Dexie transactions
and Addon replication own persistence. Device visual validation and full CI
remain separate from source review.
