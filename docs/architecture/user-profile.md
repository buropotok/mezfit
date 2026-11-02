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
Contact Basics reads the published canonical profile through the authorized
relationship realm. Until it exists, it shows membership-visible name and Telegram
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
validator is extracted unchanged into relationship-access.ts and re-exported by
assigned-programs.ts, avoiding a program/database initialization dependency in Flex.

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
retries do not create a render or transport retry loop.

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

PR 3 owns override read/write/reset and override→profile resolution. PR 4 owns
Blob avatar values/upload/override. PR 5 owns contact-card migration and retirement
of old Worker avatar APIs. Those features and workout/program business changes
remain outside PR 2.
