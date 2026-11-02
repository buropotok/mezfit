# Own user profile and shared profile navigation — PR 1

## Ownership and storage

A profile belongs to the authenticated actor, independently of Coach/Client roles.
`UserProfileRepository` exposes `readOwn`, `observeOwn`, `createOwn`, `updateOwn`
and the form's idempotent-row `saveOwn` operation. There is no foreign-user read
argument. Every target is `user / actorUserId / actorUserId` and Flex assigns the
actor as owner. React uses this repository, which composes the existing
`FlexAttributesRepository`. IndexedDB transactions include all changed values
and add-only definitions; failures roll back the entire save. Addon owns cloud
replication. No new table, REST endpoint, ACL or schema is introduced.

Eight canonical keys are declared in `USER_PROFILE_KEYS`, all prefixed `profile_`.
Age is derived from birth date. Empty text and null weight remain explicit clears.
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
Contact Basics reads only membership-visible name and Telegram ID and explicitly
states that the profile is not published. It never reads a contact's private realm.
Own unsupported sections use explicit placeholders.

`UserProfileNavigationShell` observes the actor-scoped repository, retaining only
a query snapshot and an explicit form draft. It composes the existing
`ClientWorkoutNavigationShell`/`NavigationShell`, with no second router or history.
Unregistered Clients render My profile / Basics within that shell. Tab selection,
calendar/menu entry and FAB navigation cannot bypass registration. Successful
local Save keeps My profile open and unlocks normal navigation. Coaches retain
their normal interface without mandatory registration. Read failures expose Retry;
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

## Form surface contract

The reused form uses Konsta 5.4.0 ListInput floating labels, List/ListItem/Radio and
the existing side-panel DatePicker. Its three input surfaces are exclusively
GlassSurface `preset=modalTuned`, `optics=false`, `shape=auto`; blur inherits the
App provider. Lists use `strong=false`, inputs use public `colors.bgIos`, and
radio rows use public `colors.activeBgIos`. No feature CSS targets Konsta/private
UI Kit selectors, backgrounds, radii or typography. Shared semantic Text presets
own product copy. No second glass wrapper encloses the own Basics form.

## Verification and limits

Repository tests cover actors/role-independent identity, validation, atomic failure,
reactive reads, reopen, repeated migration, newer/cleared values, late legacy sync
and partial canonical download protection. Form and navigation tests cover
read-only Telegram identity, retryable Save, glass props, onboarding lock, account
change and draft preservation. Existing client-program/exercise tests are retained.
CI runs typecheck, tests and build after PR creation; no local npm commands are run.
Physical 320px iOS/Android WebView keyboard, focus, safe areas, avatar rendering and
BackButton behavior still require device validation.

A-007 remains an external dependency: this PR consumes authenticated MeResponse,
whose Telegram metadata refresh policy is owned by Worker bootstrap. It does not
silently introduce a second identity source or change that policy.

Publication into relationship realms, override keys, contact edits, Blob avatars,
photo upload, Worker avatar routes and workout/program business rules are outside
this PR.
