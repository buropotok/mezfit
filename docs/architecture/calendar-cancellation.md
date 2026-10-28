# Calendar cancellation — working branch

This branch is a work in progress and is not ready to merge.

Implemented draft:

- Separate authorized cancelled-workspace projection, retaining calendar membership and draft visibility filters. Default scheduling reads still omit cancelled records.
- Basket toggle in the calendar, read-only grey cancelled cards, original date navigation and client filters.
- LiquidCollapse in UI Kit with a standalone demo. It reuses reverse LiquidPopover contour geometry with live React card content; no DOM screenshots, primitive restyling or third-party package modifications.
- Explicit cancellation from the calendar's occurrence editor, after its Sheet closes.
- Atomic Start-time detection of another athlete's coached booking occupying the actual Start instant. A public Konsta Sheet offers cancellation, a disabled transfer action pending the separate transfer task, and Back. Its cancellation runs after Sheet closure and retries Start against current local data.
- Same-athlete/different-day decisions and completed-session calendar placement are outside this branch.

## Blocking deletion distinction

Current `WorkoutOccurrenceDraftRepository.delete()` is a discard operation. It either restores the last published PLAN or writes `cancelledAt`; it does not delete the occurrence. The installed Coach calendar policy grants `cancelledAt` writes but no `delete` on `workoutOccurrences`.

Consequently it is not safe to ship a basket projection together with the current discard-as-cancellation path: discarded drafts would appear in the basket. The requested Delete button for published bookings cannot be implemented honestly by calling this method.

Proposed decision for the owner: authorize a separate narrowly scoped permanent occurrence-deletion operation and its protected Coach ACL extension, preserving existing discard-changes behavior. Never delete an occurrence linked to a started/completed session through this action. Ordinary Client grants remain unchanged. A protected manual operator, exact old/new role profiles, membership compatibility and real-user permission checks must be prepared after authorization; no live permissions have been changed by this working branch.

Once approved, finish the deletion distinction, add cancellation/delete integration coverage and the Training-tab caller, then complete commit review and request permission to open the PR under the project's audit rule.

## Review and verification

Existing tests inspected: occurrence drafts, planned-workouts lifecycle, TodayPage, OccurrenceDraftSheet, and BottomSheet lifecycle. Existing tests have not been modified. New draft tests cover Start conflict classification and animation fallbacks. No npm commands, typecheck, build or test runs have been performed; CI belongs after PR creation.

Relevant audit factors to review before PR: A-003 (nested navigation/back), A-005 (concurrent mutation reconciliation), A-008 (private primitive CSS), A-012 (duplicate raw controls). These are review categories for this change, not claims that their historical findings have all been fixed.
