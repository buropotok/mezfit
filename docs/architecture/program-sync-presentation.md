# Per-program synchronization presentation

The local-only `localProgramSync` table is added in IndexedDB schema v7 and
excluded from Dexie Cloud using `unsyncedTables`. Database/account isolation
matches `MezfitCloudDatabase`. No cloud schema or ACL changes are required.

Each authoring transaction increments the affected program's local revision in
the same transaction as its domain changes. Program creation also creates its
initial draft phase atomically. Copying a program marks the new program only;
activation also marks other locally affected programs in the relationship.

A successful global sync triggers confirmation through the public Addon API.
The application captures pending program revisions, awaits
`db.cloud.sync({ purpose: 'push', wait: true })`, and records only those captured
revisions as confirmed. In Addon 4.4.15 this public awaited push waits until
there are no pending local mutations. Changes after capture retain a larger
local revision and require another confirmation. Taking a revision snapshot
at the `pushing` event would be unsafe because the Addon may already have
collected its outgoing payload before that event.

Existing programs without local metadata remain unconfirmed until this barrier
succeeds. Global connection failures change the displayed status only for
programs with an unconfirmed local delta. Confirmed programs remain green.
Metadata is never sent to the server and is not a second mutation queue,
transport, or retry mechanism. Dexie Cloud continues to own replication.

Manual synchronization uses the existing provider push/pull recovery and then
confirms program revisions. Cancel dismisses the dialog; the public sync API
has no cancellation option. Completion is ignored after the owning account
instance is disposed.

UI uses the existing Badge, GlassSurface, Konsta Notification and Preloader,
and MezfitDialog primitives. LiquidPopover now accepts a plain `text` string without menu items. This mode
uses Body typography, browser wrapping and the existing morph/material/close
pipeline. Its raster payload uses DOM Range positions from the same text node
as the live HTML handoff. Existing menu/grid mechanics remain unchanged.

Verification follows repository workflow: tests/typecheck/build run in GitHub
Actions after PR creation. Tests cover local delta isolation, persistence,
rollback, concurrent edits during upload, authorization, ordering, initial
phases, notification recovery and status presentation.
