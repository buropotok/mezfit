# Program days and template card mode

## Scope

`CloudProgramDetailsPage` renders days inside their phases through
`WorkoutSessionCard mode="planning"`. A program day is a reusable template,
not an active workout session and not a scheduled occurrence. Its card shows
name/category, author, exercises and set recommendations. It has no execution
date, elapsed time, completed-set counters, numeric PLAN or FACT.

Day creation uses the existing Mezfit Dialog/Konsta ListInput composition:
choose a phase when more than one exists, then enter required name and optional
category. Names/categories have a 120-character limit; empty category is stored
as null and displayed as «Без категории». A day comment is optional (4000 chars).
New days append after the maximum persisted phase position. Menu actions move
one position up/down within that phase; an app-owned wrapper animation follows
the persisted subscription update, respects reduced motion and releases animations
on unmount. No UI Kit/private DOM or drag sensor is modified.

Start, Schedule and Add exercise are visible but disabled for authors. Their
navigation, exercise selection and new set editor are deliberately deferred.
The future scheduling iteration distinguishes coached in-person and independent
sessions. Independent sessions do not reserve the coach's availability.

## Persistence and identity

UI intents call `ProgramManagementRepository`. Local Dexie transactions own
day creation, metadata/comment changes, ordering and graph copies; liveQuery
updates the screen without awaiting network. Addon owns cloud synchronization.
Numeric legacy workout/API IDs are not coerced into template IDs. Existing
executing/completed card consumers continue using their previous contract.

No tables or indexes change: Dexie v6 and the existing server schema remain.
`category`, `comment`, optional set recommendations/links and parent `deletedAt`
are non-indexed optional attributes, compatible with existing rows. The set
editor will use `setLabel`, `comment`, `materialLinks` and `chatLinks`; numerical
loads belong to a future per-occurrence plan. Old numeric attributes are retained
in storage/copies for compatibility but omitted from template UI.

All descendants use the program's realm and its authorized PLAN author as owner;
legacy ownerless rows remain readable. Both program readers reject foreign realms,
foreign owners and orphaned descendants. The athlete projection hides draft phases
and their days. Personal authors can edit their own PLAN; an assigned client cannot
invoke the repository's PLAN mutations.

Duplicate day/phase/program copies active descendants with new IDs in one local
transaction; copied phases/programs are drafts. It never copies occurrences or
execution history. Failure to insert any child rolls back the local copy.

Removing a day sets its existing `status` to `deprecated`. Nonempty phases/programs
use a `deletedAt` tombstone; programs with session history also use a tombstone.
Descendant rows and session snapshots/FACT stay intact. Readers require a visible,
present ancestor, so late offline children do not resurrect a deleted parent.
Empty headers without history continue using the existing predicate deletes.
Active phase/program removal still requires changing its status first.

## Shared realm ACL rollout

The reviewed Coach `manage` allowlist becomes exactly:

    trainingPlans, programPhases, programDays, programExercises, programSets

Client permissions and both roles' FACT/snapshot/lifecycle permissions are unchanged.
The Worker accepts three exact Coach policy versions during rollout: original
program-only, program+phase and this complete five-table list. Partial descendant
policies and extra privileges are rejected. Deploy this compatible Worker **before**
importing the expanded policy, or invitations on the old Worker will fail.

`cloud/roles.json` is configuration source, not an automatic deployment. Neither PR
CI nor the protected schema/catalogue key is authorized to import roles. An owner
must apply the ACL through the existing approved administrative route, then verify
real Coach A/Client B/Client C reads and direct Cloud write denials. Source tests
with fake IndexedDB verify local boundaries only, not deployed Cloud enforcement.

Shared day writes are preflighted against the synced global Coach descendant policy;
an older policy results in an explicit local error instead of a claimed shared save.
Personal authoring remains available without that shared role. Addon sync notices
continue distinguishing local success from cloud confirmation. After rollout,
confirm Coach day create/edit/reorder/copy/delete, Client read-only assigned cards,
private personal authoring, and cross-client isolation before declaring deployment
ready. The existing program-management activation flag is unchanged.

## Review and verification

New tests cover phase selection and required fields, template/read-only UI, local
live observation, realm/author checks, ACL preflight, atomic copy rollback, ordering,
tombstones/history, pending/error handling and animation cleanup. Tests protecting
the retired nonempty-tree prohibition and headers-only role configuration are
updated to the approved descendant behavior. Existing execution tests remain.

Tests, typecheck and build run in GitHub Actions after PR creation; no npm commands
are run locally under the project workflow. Changes do not add REST CRUD, a second
database, synchronization queues, privileged credentials or permission deployment.
