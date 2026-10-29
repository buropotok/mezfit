# Flex Attributes foundation — realm-scoped EAV

Status: infrastructure PR; cloud activation and ordinary-account authorization have **not** run.

## Scope

Two synced Dexie Cloud tables support additional user/session settings without a schema
migration for each new key. This is an extension mechanism, **not** a replacement
for protected domain fields or an authorization mechanism. Workout PLAN, FACT,
membership, identity and lifecycle still use their established repositories and
server-side permissions. The UI for resistance bands and the UI Kit RangePicker
are deliberately outside this PR.

| Table | Primary key in Dexie Cloud | Data |
| --- | --- | --- |
| `flexAttributes` | `id` (deterministic) | `id, realmId, owner, key, valueType` |
| `flexValues` | `id` (deterministic) | `id, realmId, owner, entityType, entityId, attributeId, value` |

The local schema also indexes `realmId`, `[realmId+key]`,
`[realmId+attributeId]` and `[realmId+entityType+entityId]`. Each
attribute is **defined within the same realm as its values**. A session's shared
values cannot point at an inaccessible personal-realm definition; repeated key
names in different realms are distinct records. No separate cloud administrator
or global attribute publishing is needed to create new definitions.

`FlexAttributesRepository` is the only supported feature write/read boundary.
The actor is an authenticated `tg:<id>` identity; the repository checks that
`user` targets are the actor's personal realm and that `adHocSession`
targets exist, belong to the requested realm, and identify the actor as athlete
or coach. It validates keys (ASCII identifier, up to 64 characters), declared
types (`string`, finite `number`, `boolean`), string size (up to 1024),
and explicit `null` clearing. Immutable deterministic IDs and an atomic
local Dexie transaction avoid duplicated rows and partially applied batches;
updates modify only `flexValues.value`. The canonical owner for shared
records is the relationship realm ID sentinel, not the editing user. Personal
records use the actor as both realm and owner. New entity types may be supported
by new repository validation without changing either table schema.

The initial entity type allowlist is `user` and `adHocSession`.
No generic code may form arbitrary targets from untrusted UI input.
There is **no actual polymorphic database foreign key**: the application
repository checks the parent, while the server uses realm membership/role ACL.
A cloud `add` grant does **not** verify `entityType`, `entityId`,
`attributeId`, or the parent record's type, lifecycle or ownership.
A user with a relationship grant could create arbitrary extension rows in that
authorized realm; therefore **never use these rows as a source of truth for
PLAN, membership, roles, scheduling, protected FACT fields or permissions**.
Future consumers must enforce explicit entity/attribute eligibility in their
domain repository. This is a deliberate security limit of a generic EAV table,
not a substitute for server-enforced PLAN/FACT ACL.

## Coach / Client privileges

The target ACL adds only `add: flexAttributes, flexValues` and
`update: flexValues[value]` to both Coach and Client relationship roles.
There is **no** `manage`, `delete`, `flexAttributes` update,
or identity/realm/owner/parent-reference update grant. Personal-realm access
comes from built-in realm ownership; no new global visibility is granted.
New data does not grant access to a foreign realm. A coach cannot read or edit
a client's personal palette merely because the client is in a relationship.
Shared session values are accessible in that session's relationship realm.
`null` is an explicit reset; deletion uses no physical row removal.

## Configuration activation

`.github/workflows/dexie-flex-attributes.yml` uses the existing protected
`DEXIE_CLOUD_WRITE_KEY` environment secret in `dexie-production`. It runs
only by manual owner dispatch from `main`, with reviewer-protected environment
and serialized privilege-writer concurrency. No PR/push invocation or new key.
The operator embeds exact reviewed schema and ACL manifests independently from
the files; the installed roles must match the complete `Client` execution
baseline defined by `EXPECTED_CLIENT_SESSION_ROLES` or a permitted partial
Flex upgrade. An earlier baseline must be activated by its own existing workflow
first; no implicit role migration or permission widening is permitted.

1. Review PR, source tests and manifests; merge the reviewed PR to `main`.
2. Verify the protected environment requires reviewers, actor is repository
   owner, and previous Coach coached-start ACL is installed.
3. Manually dispatch `Apply Dexie Cloud Flex Attributes schema and ACL`
   with `operation=preview`. Inspect full schema/roles compatibility and
   exact added tables/roles.
4. Manually dispatch `operation=apply` with literal confirmation
   `APPLY_FLEX_ATTRIBUTES_SCHEMA_AND_ACL` and approve the environment gate.
5. The operator re-exports both full configuration envelopes immediately
   before import, refuses drift or payload changes, imports only missing
   reviewed schema/role deltas, then verifies the complete before/after
   configuration (including old tables, other roles, metadata, seal).
   Post-attempt readback runs even if the import step returns an error.
6. Configuration readback is **not** proof of real user permissions. Verify
   using ordinary, authenticated Coach/Client accounts against the server:
   personal write/read; shared session write/read; different actor from
   same relationship; unauthorized third actor; foreign realm; revoked
   relationship; deliberate attempts to change identity/owner/realm,
   attribute type, parent IDs, `flexValues.attributeId`, and cloud role
   privileges. Confirm denied writes do not sync and no protected PLAN/FACT
   operation is authorized by an extension row.
7. Only after verified remote activation may product features depend on
   cloud persistence of Flex data. A local write before activation does
   not establish remote authorization or durability.

No data imports or session rows are published by the operator. No new
`localStorage`, Cloudflare D1 business storage, REST CRUD path or sync engine.

## Planned resistance band usage (separate PR)

Five built-in band defaults live in app code. The personal `user` realm
stores only changed values, using keys `Band_1_color`, `Band_1_min`,
`Band_1_max` (similarly for bands 2–5). When a workout is started, the
relevant palette may be snapshotted into the `adHocSession` realm using the
same keys. The selected band itself remains an individual set's FACT, not
a session-wide selection. Editing personal defaults must not rewrite
historical session values. The subsequent feature PR must specify precise
snapshot timing and preserve immutable historical meanings.
