# User profile, publication and shared profile navigation

## Ownership and storage

A profile belongs to the authenticated actor, independently of Coach/Client roles.
`UserProfileRepository` exposes `readOwn`, `observeOwn`, `createOwn`, `updateOwn`
and the form's idempotent-row `saveOwn` operation. There is no foreign-user read
argument. Every private target is `user / actorUserId / actorUserId` and Flex assigns the
actor as owner. React uses this repository, which composes the existing
`FlexAttributesRepository`. IndexedDB transactions include all changed values
and add-only definitions; failures roll back the entire save. Addon owns cloud
replication. No new table, REST endpoint, ACL or schema is introduced.

Eight canonical keys are declared in `USER_PROFILE_KEYS`, all prefixed `profile_`.
All editable fields are optional. Non-empty values retain their format/range validation.
Age is derived only from a supplied birth date; empty birth date is a valid explicit clear.
Empty text, undisclosed sex and null weight remain explicit clears.
Telegram identity is outside the editable draft. Telegram ID and username are
rendered from authenticated `MeResponse`, never from editable legacy Telegram
text. First/last name defaults can be edited without changing Telegram identity.

## Legacy compatibility

`ClientIntake_*` records are retained, including the unused legacy Telegram value.
`readOwn` independently validates legacy and canonical profiles and selects the
complete profile with the newer `updatedAt`; canonical wins a tie. Canonical
records must contain every expected typed field. Fields from different key sets
are never merged; an empty canonical field is never filled from legacy data.

On profile subscription initialization, explicit `migrateOwn` copies the selected
legacy profile into canonical keys within one local transaction, preserving its
timestamp. It does nothing when canonical values are incomplete (including before their
timestamp arrives), or when the canonical timestamp is equal or newer. A Save
against incomplete canonical values fails locally and preserves the form draft. Deterministic Flex IDs
and value-only updates make repetition safe without deleting or modifying
attribute definitions. Observing/reading never writes. New legacy writes arriving
later remain readable and can be upgraded on the next initialization or save.
New saves use canonical keys and a timestamp after the previous selected profile.

This is compatibility for the existing intake release, not a custom sync or
field-conflict engine. Concurrent same-field edits continue to follow Dexie Cloud
Addon behavior. Device clocks determine ordering of old-version timestamps;
cloud confirmation and local save are independent. Old versions cannot read new
canonical-only edits, so this dependency must be integrated after the intake base
and the updated app must be deployed consistently.

## Shared presentation

`ProfileWorkspace` owns the common Text Only tabs and accepts a typed `self` or
`contact` view and authorized Basics/Program/Exercises content slots. CoachShell
continues to supply its existing client-program and performed-exercise views.
Contact Basics resolves relationship overrides over the published canonical profile
through the authorized relationship realm. Until it exists, it shows membership-visible name and Telegram
ID and an explicit not-published state. It never reads a contact's private realm.
Own unsupported sections use explicit placeholders.

`UserProfileNavigationShell` observes the actor-scoped repository, retaining only
a query snapshot and an explicit form draft. It composes the existing
`ClientWorkoutNavigationShell`/`NavigationShell`, with no second router or history.
On the initial local read, Clients without a saved profile are offered My profile /
Basics once per account in the mounted shell, only while still at Today. This is
an ordinary navigation request, never a route override or registration lock.
Profile tabs, primary navigation, menu, role switching and FAB remain available
before Save, during loading and after read failures. Later observations/retries
never redirect the user back. Save does not navigate, including when it finishes
after the user leaves. Coaches retain their normal initial destination.
Read failures expose Retry inside the profile;
a failed refresh/retry preserves a mounted draft. Account changes invalidate the
old query/form and stale async completions cannot navigate the next account.

Client replaces its Settings tab with a small shared Avatar. The public icon pair
contains ordinary layout around that Avatar. Its existing CSS is extracted into
`ui/avatar.css` and also injected into the panel's existing Shadow DOM, along with
shared semantic typography. Slot dimensions, optical lens, startup artwork path,
animation and gestures remain owned by LiquidGlassIconOnly. Cloud self-avatar
uses the existing authorized loader, then the existing Telegram photo and Avatar
initials fallback; no upload or new media endpoint is added.

Settings remains one SettingsPage, opened from both navbar menus. App remembers
its source destination per role and supplies the existing level-two Back context.
Coach My profile is the first system menu item and also uses that established Back
context. Role switching does not create another profile. Profile tab state is
retained across destination changes and reset for account/role changes.
The surrounding PlannedWorkoutStartProvider keeps a stable Context/children tree
when its enabled capability changes. Disabled destinations expose a null Start
context and instantiate no Start repositories; they do not remount NavigationShell,
profile state or the live liquid-tab scene. Capability changes still invalidate
pending Start generations and dismiss transient workflow state.

## Form surface contract

The reused form uses Konsta 5.4.0 ListInput floating labels, transparent Lists,
the existing LiquidPopover for sex and the side-panel DatePicker. Its two input surfaces are exclusively
GlassSurface `preset=modalTuned`, `optics=false`, `shape=auto`; blur inherits the
App provider. Lists use `strong=false`, inputs use public `colors.bgIos`, and
no Radio/ListItem sex surface remains. No feature CSS targets Konsta/private
UI Kit selectors, backgrounds, radii or typography. Shared semantic Text presets
own product copy. No second glass wrapper encloses the own Basics form.

## Verification and limits

Repository tests cover actors/role-independent identity, validation, atomic failure,
reactive reads, reopen, repeated migration, newer/cleared values, late legacy sync
and partial canonical download protection. Form and navigation tests cover
read-only Telegram identity, retryable Save, glass props, optional onboarding/navigation, account
change and draft preservation. Existing client-program/exercise tests are retained.
CI runs typecheck, tests and build after PR creation; no local npm commands are run.
Physical 320px iOS/Android WebView keyboard, focus, safe areas, avatar rendering and
BackButton behavior still require device validation.

A-007 remains an external dependency: this PR consumes authenticated MeResponse,
whose Telegram metadata refresh policy is owned by Worker bootstrap. It does not
silently introduce a second identity source or change that policy.

## Automatic publication (PR 2)

The private `user / actorUserId / actorUserId` target remains the editable source.
A role-independent UserProfilePublicationProvider observes repository snapshots
above the navigation tree. A changed saved profile, a newly confirmed relationship,
or completion of a partial shared download triggers idempotent local publication.
No background Worker, REST CRUD, second database, outbox, private Addon internals,
new tables/fields, or schema/ACL changes are introduced.

UserProfileRepository publishes only the eight canonical `profile_*` values to
`entityType=publishedUser, entityId=actorUserId, realmId=relationshipRealmId`.
Each shared definition and value retains the existing shared owner sentinel
`owner=realmId`; private ownership is unchanged. Generic Flex validation admits
only the exact existing Worker-provisioned realm and two accepted role memberships.
Repository writes to this target require entityId=actorUserId; reads permit either
member through that same authorized relationship. The original approved-pair
validator lives in relationship-access.ts and is re-exported by assigned-programs.ts,
avoiding a program/database initialization dependency in Flex. Its structural checks
are preserved. Relationship reads remain in the Dexie transaction; only the pure
WebCrypto validation uses Dexie.waitFor. No waitFor scope wraps database operations
or another waitFor, which would create an interdependent transaction wait.

Publication commits all eligible copies atomically in local Dexie, independently
of the prior successful private Save. Failure leaves that private profile intact
and exposes Retry. Repeated publication changes no identical values or IDs.
Newer published timestamps win over a stale local source. Partial existing copies,
including values whose definitions have not arrived, are never overwritten or
acknowledged early. Completion is observed reactively; readers require all typed
canonical fields. Definitions are add-only, explicit clears remain empty/null,
and no override key is created, cleared or rewritten by publication.

The capsule beside the title uses the existing BadgeChoice/Badge colors:
green Synchronized, yellow Pending, red Error, gray Offline/Not saved/Loading.
Its LiquidPopover explains the state. Green requires a completed public Addon
push barrier after publication and an unchanged snapshot of the private profile,
authorized relationship set and complete published copies. This is ephemeral
presentation confirmation, not persisted parallel business data or a custom
sync transport. Edits during an awaited push remain pending. Save never waits
for that barrier. Account switches discard stale callbacks and acknowledgements;
retries do not create a render or transport retry loop. Observation failure invalidates
the current status snapshot until a fresh subscription succeeds; contact snapshots
are scoped to the repository instance as well as actor, realm and subject.

Telegram ID and username stay outside the editable/published draft; identity is
read only from existing authenticated/membership sources. Telegram ID, Telegram,
Birth date and Sex use Headline labels with Body values. Sex is selected through
LiquidPopover and displayed as “Пол: муж/жен/не указан”. The last-modified
caption is below Save. Layout wraps within 320px without primitive geometry,
background or typography overrides.

The installed Flex grants still govern remote access. Existing generic shared
metadata grants allow either authorized member to update extension values at the
server; this feature's own-only publication restriction is a repository contract,
not a new server-enforced immutable-author guarantee. Published profile metadata
must never authorize identity, membership, PLAN or protected FACT. Live ordinary
Coach/Client cloud permission and two-device checks remain required; CI/local
transaction tests do not prove server activation or remote acknowledgement.

## Relationship overrides (PR 3)

UserProfileRepository exposes readContact/observeContact, saveContactOverrides and
resetContactOverride. It remains the sole profile repository. The resolved view
contains the immutable published snapshot, effective values, overridden field
names, edit capability and incomplete-download state. No private peer realm is read.

Seven fields are eligible: first/last name, email, phone, birth date, sex and weight.
Telegram identity, avatar and publication timestamp are not override fields.
Each override uses its matching override_* key in the existing publishedUser
target: entityId=clientUserId, realmId=relationship realm, owner=realmId sentinel.
There are no new entities, tables, schema or ACL changes. The Coach in that exact
Worker-confirmed pair may mutate Client overrides through the domain API; a Client,
outsider, different Coach or revoked member cannot use it. Flex's dedicated
setProfileOverrides entry point admits only override_* writes for that pair;
ordinary peer profile_* writes remain forbidden. Existing generic shared Flex
server permissions remain unchanged: both members can access shared metadata.
This is not a new server-enforced single-writer or private Coach-notes mechanism.

Resolution is per field: an active override wins, otherwise the published value
wins. Empty text and undisclosed sex are explicit overrides. Text and sex keep
their native Flex string values. Nullable weight alone uses a JSON scalar string:
"62" represents 62 kg; "null" explicitly hides the supplied weight. A Flex null
resets any override, including weight, restoring the latest published value.
This distinction requires no active flags, companion records or physical deletes.
All keys in USER_PROFILE_OVERRIDE_KEYS have the add-only valueType=string.
Stored scalars are decoded as unknown and validated with the existing business
validation. Unknown fields and malformed values are rejected before batch mutation.

Save validates the patch and writes only deliberately edited fields in one local
transaction. It neither copies untouched published values nor modifies profile_*,
the Client's personal data or other relationships. Publication continues to update
only profile_* and preserves overrides. Reset writes only the selected override
value to null. Both operations return the committed resolved view; failures roll
back all writes and remain retryable. Cloud Addon alone handles transmission:
these operations never await push, change credentials or drive another sync loop.

Values arriving before their add-only definitions expose an incomplete state.
The UI withholds edit/reset controls until the resolved view is ready, and Save
refuses to overwrite that partial download. Invalid stored overrides produce an
error rather than silently selecting another user's data. Read/observe stay
side-effect free.

Contact Basics starts in view mode with effective values only. Per-field override
labels and Reset appear exclusively in the editor.
Edit reuses UserProfileForm inline in the same ProfileWorkspace tab. The form
tracks changed field names; background publications do not freeze untouched fields
as overrides. Failed saves, refresh errors and partial publication preserve the
mounted draft. Account/repository/contact changes invalidate old mutation responses.
The editor is outside the read-only glass wrapper, retaining exactly the existing
two auto-shaped modalTuned/optics=false input surfaces and inherited blur.
Sex uses the same LiquidPopover and birth date the same side-panel DatePicker.
No UI Kit mechanics, CSS, primitive geometry, navigation/history or programme and
workout business logic changes are introduced.

Domain tests cover precedence, explicit clears versus reset, latest publication,
normalization, local reopen, idempotency, relationship/role isolation, revoked
access, validation, transactional rollback, late definitions, malformed values,
retry and offline commits without transport. UI tests cover changed-only patches,
reset failures, draft preservation and stale completions. Existing read-only and
Coach workspace assertions remain intact; their source fixtures now supply the
resolved relationship view. Commands run only in GitHub Actions after PR creation.
Physical WebView and remote multi-account permission checks remain separate.

## User avatars and shared presentation (PR 4)

`UserAvatarRepository` owns `profile_avatar` and `override_avatar` in the existing
user/publishedUser Flex targets. The add-only definition type is `avatar`. One
value contains `{version, revision, small, large}`: both bounded JPEG Blobs and an ISO
version are committed together, preventing mixed variant revisions. A UUID revision
distinguishes separate device writes with the same millisecond timestamp. A user-selected
JPEG, PNG or WebP (up to 20 MB) is decoded and compressed in the WebView by the
existing Canvas encoder: small <=128 px / 50,000 bytes and large <=512 px /
245,000 bytes. Original files are never persisted. Known Addon BlobRefs are
validated as pending images, not interpreted as application URLs.

Own saves use the actor's private realm and owner. Publication copies only
profile_avatar to each structurally verified relationship using owner=realmId;
it leaves override_avatar intact. It works before questionnaire Save and upon
new relationship membership. Identical/newer published versions are not rewritten.
Missing definitions or unhydrated variants stay incomplete and are not overwritten
or acknowledged. Atomic null variants with a new version remove an own/overridden
image; Flex null resets the override to the latest user publication. Physical
deletes are not used. Only the Coach of that exact relationship can mutate a
Client override through the repository. Existing shared Flex server visibility
and its known non-authoritative metadata grant limitations remain unchanged.

The existing profile publication provider includes the avatar snapshot in its
ephemeral version and uses its existing public push confirmation. UI Save never
waits for it. Blob transfer, retry and offline storage belong to Dexie Cloud Addon
4.4.15 / Dexie 4.4.6; no custom upload transport, manual blob cache, new database,
table, schema installer, ACL change or privileged Worker operation is introduced.
Reference: https://dexie.org/docs/cloud/blob-offloading . This additive value-type
contract requires consistent deployment of the new client; old clients that reject
unknown Flex types must be refreshed. No existing definition type is changed.

`useCloudContactAvatarUrl` selects a relationship override, then the user's
published image, then the existing Telegram source, then Avatar initials. Own
surfaces use the personal source even without relationships. Downloads invalidate
the source through the existing blob-progress revision. Subscriptions, snapshots
and object URLs are scoped to database/account/subject; replacement/unmount revokes
temporary URLs. The upload editor supports retry, duplicate-action suppression
and stale compression/write completion guards. Contact controls/override captions
appear only in editing, including avatar-only editing before a profile is published.
UI Kit mechanics, styles and primitive geometry are unchanged.

`resolveContactNames` enriches the authorized common contact snapshot through
UserProfileRepository. Effective first/last names resolve per field from overrides
over published questionnaire values, with the existing contact name used only
when no usable publication exists. Explicit empty names use a generic display
label, never resurrecting a deliberately cleared legacy name. Names never replace
Telegram IDs, user IDs, membership or authentication. All current CloudContact
consumers (directory, navigation, program/workout/calendar cards and pickers) receive
the same reactive projection after Save, Reset and new publications. Avatar/name
projection failures cannot block the directory or cloud transport.
Keyed Flex reads select only the requested fields: resolving names/questionnaires
does not load portrait bytes, and avatar readers do not fetch unrelated user data.

Per-field Reset updates only that field in the mounted form draft and removes it
from the changed-field patch; other unsaved edits remain. View mode contains no
override labels or Reset controls. Legacy tests expecting those view controls are
updated to enter Edit first; their failure, reset and stale-visit checks remain.
New tests cover storage/atomic rollback, publication without questionnaire, new
relationships, authorization/isolation, pending BlobRefs/definitions, name updates,
upload retry, duplicates, stale completions and temporary URL disposal. Test source
was reviewed; tests/typecheck/build run only in GitHub Actions after PR creation.
Real two-account cloud permission/blob transfer and iOS/Android WebView image picker,
Canvas memory, 320px layout and offline reopen still need device verification.

PR 5 may retire the remaining Worker Telegram avatar/bootstrap APIs. They remain
the current fallback in PR 4. License diagnostics remain outside this PR.

## Avatar source continuity across navigation

CloudConnectionsProvider owns UserAvatarSources for the current database/account.
This is an in-memory render cache of repository snapshots and temporary Blob URLs;
Dexie/Addon remain the only persistent image store and transport. One lazy observer
per visited authorized subject stays alive across screen unmounts, so the next
screen receives the ready source synchronously through useSyncExternalStore. Small
and large URLs are created only when requested. Replacement, reset and publication
continue to invalidate the source even with no visible avatar consumers.

An unresolved/incomplete source must not be treated as absence of an override.
During a cold read the hook supplies a neutral transparent image through Avatar's
existing src prop; this also prevents callers' Telegram photo fallbacks from
flashing. A confirmed absence/reset permits the normal Telegram/initials fallback.
No primitive geometry, styling or mechanics are modified. Isolated consumers
without an account provider use the same source owner locally and dispose it on
unmount. There is no global or persistent shadow cache.

Relationship reconciliation retains only authorized source keys plus the actor's
personal source. Revocation, account disposal and source replacement revoke URLs;
observer generations reject stale callbacks after refresh/revocation/disposal.
The existing Addon blob hydration revision and explicit contacts refresh retry
pending/error reads. Regression tests cover the first render with a preloaded
Telegram image, remount continuity, replacement/reset while hidden, variants,
permission removal, stale callbacks and account isolation. Existing tests are
retained; CI runs verification after PR creation, with physical WebView validation
still required.
