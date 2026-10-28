# Calendar cancellation and logical deletion

Approved product decisions, 2026-10-28:

- Cancel writes `cancelledAt`, releases occupancy and moves a workout into a basket below calendar search. The basket toggles the same date/client-filtered timeline to cancelled workouts only. Cancelled cards are grey with grayscale avatars and open read-only.
- Delete writes `inactive: true`. It removes a workout from all product views, including the basket, while retaining its PLAN, cancellation time, identity and provenance. There is no physical DELETE and no Restore UI.
- Old cancelled records, including previously discarded test drafts, appear in the basket. The owner explicitly chose manual removal of these few test records; do not migrate/reclassify them automatically.
- Discard changes of an edited published workout still restores its last published PLAN. This remains distinct from deleting the whole workout.
- Started/completed sessions and linked occurrences cannot be cancelled/deactivated through these calendar actions. Repositories re-read and validate at local transaction acceptance, including stale confirmations.

## UI ownership and sequencing

`OccurrenceDraftSheet` exposes Cancel above Delete. Cancel flushes editor intents, closes its parent Sheet, and starts the cancellation only from the owner's `onClosed` callback. Delete has a confirmation and closes on successful local acceptance. An error remains visible and does not animate success.

`LiquidCollapse` is a UI Kit presentation primitive with an interactive catalog example. It uses the existing reverse LiquidPopover contour geometry and live React content, including avatars. It does not screenshot another component's DOM, alter LiquidPopover, or change Konsta packages. Calendar-owned source refs measure cards; a body portal renders the transient animation. Reduced motion, an absent/offscreen source or missing target skip animation. Navigation/unmount releases pending presentation. No cloud sync is awaited.

Start is shared by the calendar and Training tab, including planned, program-day and quick starts. Its local atomic materialization detects another athlete's coached booking occupying the actual Start instant, excluding the selected occurrence, personal events, independent bookings, inactive/cancelled bookings and existing executions. It does not cancel the same athlete's other day, reserve a speculative future interval from expected duration, or treat a running session's overrun as this cancellation conflict.

A public Konsta Sheet shows the other athlete and Cancel / Transfer / Back. Transfer is disabled in this PR; its implementation and same-athlete/different-day wording belong to the next slice. Cancellation runs only after the conflict Sheet closes, then Start retries against fresh local data. Back creates nothing. Session/calendar actual-time placement remains outside this PR.

Animation runs only when a source card and basket are currently rendered; cancellation from the Training tab also works without an offscreen calendar animation. The Training tab reports post-close cancellation failures on its parent screen.

## Protected cloud permission rollout

No indexed key/table changes are needed for the optional boolean field. This is not permission to change the cloud schema. `cloud/calendar-cancellation-roles.json` contains only `inactive` field updates for Coach/Client occurrences. Baseline `cloud/roles.json`, all source PLAN/FACT/session permissions, identity fields and physical deletion policy remain unchanged.

After merge, dispatch **Apply Dexie calendar logical-deletion ACL** on `main`:

1. Run `preview`, leaving confirmation empty; inspect the exact two-role delta from the complete installed planned-session baseline.
2. Run `apply` with `APPLY_CALENDAR_CANCELLATION_ACL`, using the existing protected `dexie-production` approval. The operator immediately rechecks full schema/roles, imports only reviewed roles and verifies complete final readback, including import failures and no-op apply.
3. Use ordinary Coach/Client accounts to verify actual field authorization. Configuration readback alone does not prove it: Coach deactivation, permitted independent Client deactivation, forbidden foreign realm/identity/assigned PLAN writes and physical DELETE must be checked. No live writes or activation tests are claimed by this PR.
4. On two devices, check offline cancellation/deactivation, retained raw data, disappearance from the other device after Addon sync, inability to Start/deactivate a linked execution, and unchanged source programs. Test the animation on iOS WKWebView and Android WebView, including interrupted close, navigation away and reduced motion.

Do not re-run the earlier ACL operators as a downgrade after this overlay. Membership preflight accepts the complete earlier profiles and the exact complete new two-role profile, rejecting partial grants or unrelated drift.

## Review / verification

Relevant audit factors: A-003 (nested navigation/back), A-005 (async reconciliation), A-008 (private primitive CSS), A-012 (parallel raw controls). Public Sheet/adapter callbacks, owned refs, current local transactions and UI Kit public APIs preserve those boundaries. No unrelated audit remediation is included.

Existing occurrence, planned-workout, calendar, BottomSheet and membership/operator tests were inspected for current contracts and obsolete assumptions; existing tests are unchanged in this PR. New tests cover cancellation/deactivation retention, hidden projections, foreign access, stale started-workout deletion, conflict classification, close-before-cancel sequencing, failure/Back behavior, exact ACL profiles and protected operator boundaries.

Per project workflow, npm, tests, typecheck and build are left to GitHub Actions after PR creation. Mobile visual/real-account checks remain required; source review is not a claim that those checks passed.


## Unified Coach Start conflict check (2026-10-28)

Every Coach Start checks the same authorized local calendar workspace in its
materialization transaction. Quick and program starts include workoutOccurrences
in that transaction; a conflict rolls back the complete attempt, including any
automatically created source program. No session, source graph or occurrence
lifecycle change is accepted until the conflict has been resolved. An invalid
program/day selection fails before presenting an unrelated cancellation decision.
The acting coach is occupied by personal Start too; only another athlete's
coached booking at the actual start instant requires this cancellation flow.
Independent client bookings do not occupy the coach. Same-athlete/different-day
resolution remains a separate future case.

The existing Start context owns one pending decision for all entry points. It
waits for the conflict Sheet to close, cancels with the existing presentation,
then retries the original intent against current local data and time. Multiple
conflicts are resolved one at a time. Back cancels no booking. Program selection
is suspended while resolving a conflict and retained for return. Navigation or
account changes abandon pending resolution; a late cancellation completion must
not create a new session after the initiating screen has gone away. Already
accepted local transactions remain accepted and are not rolled back for UI
navigation. There is no sync barrier, cloud write operator or schema/ACL change.
