# Mezfit Local-First Storage and Synchronization Architecture

**Status:** Approved target architecture for pre-MVP; implementation migration pending
**Scope:** Telegram Mini App local persistence, domain repositories, Dexie Cloud synchronization, access isolation, privileged Cloudflare Worker operations
**Goal:** instant offline-capable interaction with one authoritative shared cloud database and no custom synchronization engine.

## 1. Canonical architecture

Normal reads and edits:

    React Coach / Client UI
             ↓
    Typed domain repositories / application services
             ↓
    Dexie.js / IndexedDB (local working subset)
             ↕
    Dexie Cloud Addon
             ↕
    Dexie Cloud (one authoritative business database)

Privileged control operations only:

    Telegram Mini App → typed API client → Cloudflare Worker → Dexie Cloud
                                           ├─ verify Telegram initData
                                           ├─ custom auth/token exchange
                                           ├─ invitation and membership administration
                                           └─ other explicitly server-confirmed operations

The app never receives privileged Dexie Cloud credentials or Telegram bot secrets. The Worker is not the transport for ordinary domain CRUD or synchronization. Dexie Cloud is managed infrastructure; no second Dexie Cloud Worker is deployed.

Cloudflare may still host the application and store exercise media in R2. Cloudflare D1 is not a second business database. There is one Dexie Cloud environment for pre-MVP; staging and migration of test users are not required.

**Rollout boundary:** The repository currently contains D1-backed code and custom sync design. This document specifies the target; documentation alone does not migrate the running application. Replace obsolete runtime paths in focused implementation PRs, rather than silently maintaining two active authorities.

## 2. Repository boundary

React components never import Dexie, Dexie Cloud Addon, IndexedDB, or cloud REST clients directly. They use typed domain repositories/application services. Keep the local persistence adapter replaceable for future native ports.

The established HTTP API client remains for privileged Worker operations only. Domain reads, edits, and local analytics do not await REST. Local transactions commit first; Dexie Cloud Addon synchronizes in the background.

## 3. Data visibility and realms

Dexie Cloud holds all users' business data, but each device synchronizes only records permitted by server-enforced realm membership and permissions.

- Personal user realm: profile/private preferences and personal data.
- Personal coach realm: coach-only exercises, favourites, private notes and reusable invitation metadata (Worker-only validation of invitation tokens).
- Shared realm **per coach-client relationship**: assigned programs, phases, days, exercises, sets, calendar occurrences, workout sessions and FACT history.
- Public realm: approved global exercise catalogue.

A coach is a member of each of their relationship realms and sees all their clients. A client is a member only of their own relationship realms and never sees another client's data. A client may have more than one coach; each relationship is isolated.

Each shared child record has its own appropriate `realmId`; referencing a parent does not inherit permissions. The user/coach-client relationship identity must remain stable. Membership, role, record owner defaults and table permissions must be explicitly checked against the installed Dexie Cloud version; UI hiding is never authorization.

**Exercise references:** A client must have access to exercise definitions used in assigned programs and historical FACT. Use a stable, accessible shared snapshot/reference of needed coach-private exercise metadata, rather than exposing the coach's whole private catalogue or breaking historical records when a catalogue entry changes.

## 4. Domain storage and stable IDs

Expected persistent domains:

    users, coach_clients
    exercise_definitions, exercise_definition_overrides, exercise_favourites
    training_plans, program_phases, program_days, program_exercises, program_sets
    workout_occurrences
    workout_sessions, session_exercises, session_sets

Use stable client-generated string IDs for offline-created objects and their references. Legacy numeric D1 `serverId` values are not part of the target domain identity contract. Preserve relational integrity, ordering, deletion/archive semantics and atomic local mutations.

Do not carry forward `sync_scopes`, `sync_remote_state`, custom server revisions, change-feed cursors, request replay or shadow synchronization metadata. Dexie Cloud Addon owns replication, retries and its supported conflict behavior. Do not implement a parallel SyncEngine.

## 5. Local-first and offline behavior

Client mode keeps the client's permitted working data locally. Coach mode keeps data for all the coach's permitted clients locally, including historical sessions needed for Previous/Plan/Fact and analytics. The following work from already-synchronized IndexedDB data without waiting for network:

- client directory and calendar;
- exercise catalogue;
- assigned and authored programs;
- workout/session history;
- local analytics and charts.

Initial sign-in, new realm membership and initial hydration require connectivity. Previously synchronized data remains locally readable offline subject to session/account security policy. Show synchronization and offline status honestly; do not claim remote persistence until confirmed. Media blobs have a separate cache policy; local records hold metadata/URLs rather than permanent copies of all videos.

A local mutation changes the smallest relevant records/fields in one Dexie transaction and updates the UI immediately. Never replace a stale whole-workout snapshot to update one set. On reconnection, Dexie Cloud Addon handles synchronization. Where edits to the same field conflict, use the documented Dexie Cloud behavior; do not promise that both competing values are preserved.

## 6. PLAN, FACT and workout lifecycle

**PLAN:** Coach authors and changes assigned plans. The client may read but must not mutate PLAN; enforce this on the cloud server through tested permissions, not merely UI restrictions. Take care with Dexie Cloud owner privileges: role settings alone may not constrain record owners.

**FACT:** Coach and client may both edit the shared workout FACT. The normal product workflow is sequential: coach records the completed sets/exercises, then asks the client to continue with **subsequent** sets/exercises. Deliberate alternating edits to the same set are not a supported MVP workflow. This handoff is a UX/business convention, not a privileged ownership-transfer operation. No per-session edit locks, leases, separate FACT realms, server-side editor handoff, trusted per-mutation audit log or custom conflict-resolution engine in pre-MVP. Rare accidental same-field conflicts are tolerated and resolved by standard Dexie Cloud behavior; they do not justify custom backend machinery.

**Workout Start:** Existing server-confirmed Start semantics materialize a consistent PLAN snapshot and change the workout lifecycle. Preserve this domain invariant when replacing D1: implement any required privileged atomic operation through a verified Dexie Cloud capability or a narrowly scoped Worker control operation. Do not assume multi-request REST calls are atomic. Do not silently switch to a non-atomic client-side sequence.

**Completion and status:** Keep occurrence/session lifecycle consistent. Derive display state from the linked local session where possible rather than writing duplicate optimistic statuses. Session FACT history must not mutate when later PLAN changes.

## 7. Telegram identity and invitations

Telegram `initData` is untrusted until verified by the Worker using the bot secret. Custom Dexie Cloud authentication/token exchange must bind the verified Telegram identity to the same stable cloud user ID on every device. Do not trust client-supplied user IDs or role claims.

Invitation links are reusable until revoked. Worker validates the invitation, verifies the actor, creates or reuses the relationship realm, and grants the minimum membership/role permissions through privileged Dexie Cloud APIs. Repeated acceptance by the same client must be idempotent; revoking a link blocks new joins but does not automatically delete existing relationships. A client cannot grant themselves access by inventing realm IDs.

Privileged REST endpoints require server-side authorization, input validation, safe error contracts and appropriate idempotency. Confirm exact API/role semantics with the chosen Dexie Cloud version before implementation; never assume arbitrary backend business transactions are automatically atomic.

## 8. Schema evolution and CI/CD

Keep Dexie schema versions and access-control configuration reviewable in the repository. Cloud permission configuration and client schema evolution are distinct operations; review compatibility before deployment. Use one Dexie Cloud database in pre-MVP and one Cloudflare deployment.

CI (PR): existing npm installation, tests, typecheck, build in GitHub Actions. CD (main): verified build and Cloudflare deployment with the public Dexie Cloud database URL; privileged credentials remain Worker/GitHub secrets. Remove D1 migration and database-binding steps when the runtime no longer uses D1, not in this documentation PR. No separate staging or automatic cloud permission push is required for pre-MVP.

## 9. Implementation sequencing

1. Verify custom Telegram auth/token exchange and Dexie Cloud realm/permission semantics with the chosen addon/server API.
2. Establish stable cloud IDs, shared realm schema, typed local repositories and permitted cloud access; confirm Coach/Client isolation.
3. Replace domain CRUD/synchronization with Dexie Cloud Addon in coherent vertical slices, retaining offline behavior.
4. Implement privileged invitations and server-confirmed lifecycle operations with explicit consistency guarantees.
5. Remove old SyncEngine, D1 domain API, D1 bindings/migrations from deployment and obsolete tests after the replacement is complete.

Tests must reflect actual product behavior, authorization boundaries, offline edits, reconnection, shared relationship access and PLAN/FACT permissions. Do not rewrite existing tests simply to make new code pass. Review test source before PR; CI executes tests/typecheck/build after PR creation.

## 10. Architectural invariant

    Normal product UI → domain repository → local IndexedDB
    Local IndexedDB ↔ Dexie Cloud Addon ↔ authorized subset of Dexie Cloud
    Privileged control → verified Cloudflare Worker → Dexie Cloud

No custom sync engine, second authoritative business database, server-enforced FACT single-writer mechanism, or multiple environments without a new product decision.
