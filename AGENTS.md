# AGENTS.md — Mezfit Engineering and Architecture Rules

Mandatory rules for all changes in `buropotok/mezfit`. Working behavior is necessary but not sufficient: changes must preserve domain boundaries, React ownership, typed contracts, backend authorization, D1 integrity, Telegram Mini App compatibility, and testability.

## 1. Preserve architecture before adding behavior

Before editing, identify the owning domain/component, its public inputs/outputs, callers, consumers, lifecycle, API contracts, tests, and persistence effects. Trace the actual runtime path before creating abstractions. Prefer extending the owner over cross-cutting patches. Do not bypass API, authorization, state, or persistence boundaries for convenience.

## 2. Canonical architecture

```text
React UI
  ├─ Client experience
  ├─ Coach experience
  └─ genuinely shared UI/domain
        ↓
typed frontend domain + API client
        ↓
HTTP API
        ↓
Cloudflare Worker
  ├─ validation
  ├─ authentication/authorization
  ├─ domain operations
  └─ persistence
        ↓
Cloudflare D1
```

Dependencies normally point downward. React must not depend on persistence implementation details; Worker code must not depend on frontend implementation details.

## 3. Client / Coach boundary

Client and Coach are distinct product contexts. Client UI owns the athlete experience. Coach UI owns coaching, client management, program authoring, and assignment. Share code only for genuinely shared concepts.

The Client Programs experience displays programs assigned to the client by a coach/backend. It is not a built-in Gym Keeper program catalog. Do not reintroduce template/catalog behavior into client mode unless the product requirement is explicitly changed.

Coach mutations affecting a client must pass through backend authorization and persistence. Frontend state, hidden controls, routes, or supplied IDs are never proof of authorization.

## 4. Single responsibility and ownership

Every module/component has one coherent responsibility. Navigation belongs to navigation; API transport to the API client; authorization to Worker/backend; persistence to backend/D1; presentation state to the rendering component.

Do not create dumping-ground modules such as `helpers.ts`, `fixes.ts`, `enhancements.ts`, or `misc.ts` for unrelated behavior.

## 5. React boundaries

Use props, callbacks, context, typed domain state, and deliberate services. Do not manipulate another component's private DOM, scrape rendered markup for state, use CSS classes as state channels, or use global events when normal React/data flow suffices.

Effects are for synchronization/lifecycle work, not for repairing incorrect ownership. Effects need correct dependencies and cleanup. Avoid copying props/server data into local state unless there is an explicit editable/draft boundary.

## 6. State has one authoritative owner

Distinguish persistent server state, domain/application state, navigation state, local UI state, and derived state. Do not duplicate mutable state or persist values that can be safely derived.

React state is not authoritative persistence. Normal persistent flow:

```text
UI intent → typed API → Worker validation/auth → domain/D1 mutation → canonical response → UI reconciliation
```

Optimistic updates must be explicit and have rollback/reconciliation behavior.

## 7. TypeScript contracts

TypeScript types are architectural contracts. Use explicit domain types at UI/API/backend boundaries. Do not maintain incompatible shapes for the same concept without an explicit mapping boundary. Validate untrusted runtime input despite compile-time types.

Do not use `any`, broad casts, or unsafe assertions to hide contract mismatches. Prefer narrow types and explicit nullability.

## 8. Frontend API boundary

Components should use the established API client rather than ad hoc `fetch` calls for existing capabilities. The API layer owns route construction, serialization, transport/auth concerns, request/response typing, and common error normalization. UI owns user-facing pending/error presentation.

Do not monkey-patch `fetch`, XHR, history, timers, Telegram APIs, or global event methods for local features.

## 9. Worker is the trust boundary

Never trust identity, role, ownership, resource IDs, or authorization decisions merely because the frontend supplied them. The Worker must establish the actor and verify authorization for protected resources.

A coach may mutate a client only when backend authorization proves that relationship. A client must not access another client's private data by changing an ID. Role restrictions are enforced server-side. Prefer deny-by-default when authorization cannot be established.

Keep authorization logic auditable and avoid subtly different duplicated checks.

## 10. Validation and error contracts

Treat JSON bodies, query/route parameters, Telegram data, and legacy persisted data as untrusted. Validate before domain mutation. Use deliberate status codes and stable error shapes. Do not expose stack traces, SQL details, tokens, secrets, or unnecessary personal data.

## 11. D1 persistence

D1 is authoritative server storage. Keep SQL out of React. Use parameterized queries. Preserve relational/domain invariants, define deletion semantics, and avoid race-prone read-modify-write flows where possible.

Multi-record mutations must not leave inconsistent partial state. Stable IDs are identity; array positions and display labels are not.

## 12. Database migrations

Schema changes require versioned D1 migrations. Never manually mutate production schema as normal development practice. Preserve existing data unless destructive behavior is explicitly required. Include backfill/normalization when a new contract requires it.

Do not rewrite already-deployed migrations; add a new migration. Review Worker changes and migrations together and consider deployment compatibility between old/new code and schema.

## 13. Data contracts over presentation contracts

Move structured typed data between layers. Do not use rendered DOM or display strings as hidden transport contracts. Preserve identity semantics for exercises, workouts, programs, assignments, clients, coaches, and related entities across UI/API/database boundaries.

## 14. Navigation is infrastructure

Navigation owns the active application surface and transitions. Features request navigation through the established contract; they do not create competing navigation state or repair navigation via unrelated DOM.

Telegram BackButton, browser history, in-app back controls, and nested transitions must have one coordinated deterministic path. Consider both Client and Coach flows.

## 15. Async ownership

The initiator of an async operation owns or explicitly exposes pending, success, failure, cancellation, stale completion, and unmount/navigation behavior. Old requests must not overwrite newer authoritative state. Repeated user actions must be deterministic. Clean up requests/subscriptions/listeners when their owner is destroyed.

## 16. Telegram Mini App boundary

Isolate Telegram APIs behind deliberate integration code rather than spreading them through domain components. Client-visible Telegram values are not automatically trusted server identity.

Changes involving navigation, viewport, safe areas, keyboard/focus, BackButton, media, startup, or authentication must consider Telegram WebView behavior.

## 17. iOS/WebKit and Android compatibility

Desktop Chrome success is insufficient. Consider viewport/safe areas, virtual keyboard/focus, scrolling, touch/drag, history, media loading, fetch/cancellation, caching, lifecycle timing, and Telegram API differences in iOS WKWebView and Android WebView.

Prefer broadly compatible APIs and feature detection. Isolate platform workarounds; do not scatter `isIOS` branches through domain logic.

## 18. Drag-and-drop and ordering

Drag state, ordering, and persistence need explicit ownership. Visual and persisted order must not silently diverge. Define a canonical ordering model, mutate it through an explicit domain/API operation, handle failure/reconciliation, and test touch/mobile behavior. Never use array index as persistent identity.

## 19. UI libraries and CSS

Use existing primitives/patterns before parallel implementations. Radix UI, dnd-kit, DayPicker, and other libraries are implementation tools, not domain owners. Do not couple domain logic to third-party private DOM.

CSS must have clear component/surface ownership. Do not use incidental selectors or CSS classes as cross-component control/state channels. Verify Mini App widths, safe areas, and keyboard-sensitive layouts.

## 20. Import-time code and globals

Imports must not unexpectedly start network work, patch browser APIs, manipulate unrelated DOM, or assume another feature is mounted. Runtime side effects need an explicit owner.

Avoid mutable `window.*` state and global registries. If a platform-level global is genuinely required, document ownership and expose the smallest deterministic interface.

## 21. Security and secrets

Never put bot tokens, API keys, Cloudflare credentials, signing secrets, or privileged credentials in browser code or committed source. Secrets belong in server/Cloudflare secret storage.

Do not log authorization headers, tokens, secrets, sensitive Telegram auth payloads, or unnecessary personal data. Return only data the caller needs.

## 22. Performance and failure isolation

Keep startup focused on shell/first-screen requirements. Avoid unnecessary startup requests, large feature-only data, expensive hidden UI, and broad observers/listeners.

A feature failure should not corrupt unrelated state or prevent the shell from working unless the dependency is genuinely critical. Catch errors only at boundaries that can recover or present a meaningful local failure state; do not broadly swallow exceptions.

## 23. Idempotency and cleanup

Initialization that may run more than once must be idempotent or explicitly reject duplication. Clean up listeners, timers, subscriptions, object URLs, pending requests, and Telegram handlers. React development/Strict Mode behavior must not cause duplicate persistent mutations.

## 24. Tests protect architecture

Test public behavior and important boundaries: domain transformations, API contracts, authorization, persistence, navigation, Client/Coach separation, failure paths, stale async completion, repeated initialization, and platform-sensitive behavior where practical.

Do not freeze accidental implementation details. For meaningful async/integration work, test malformed input, forbidden access, missing records, network/API failure, stale completion, duplicate actions, and navigation away where relevant.

## 25. Required verification

For normal code changes run:

```bash
npm run typecheck
npm test
npm run build
```

For Worker/D1 changes also verify relevant Wrangler/local migration flows where feasible. Never claim a check passed unless it actually ran; document environmental limitations.

## 26. Debugging and regressions

Understand before editing. Inspect the owner, consumers, types, API client/routes, Worker handlers, migrations/persistence, tests, navigation path, and platform-sensitive APIs as applicable.

For regressions: establish a known baseline, change one variable at a time, narrow to the smallest failure, fix the owning boundary, and remove diagnostic/workaround code. Do not stack speculative fixes or repair coupling with timing tricks.

## 27. Delete obsolete architecture

When a feature/contract is replaced, remove obsolete handlers, types, API paths, selectors, CSS, tests, and workarounds once no real consumer needs them. Parallel mechanisms create nondeterminism. Backward compatibility must have a real consumer and migration/sunset plan.

## 28. Change scope

A PR has one coherent purpose. Avoid unrelated "while here" refactors. If a separate prerequisite is necessary, make it explicit.

However, if implementation/review reveals a well-founded defect that directly violates these rules and can be safely corrected within the task's architectural scope, correct it rather than preserving a known-invalid workaround.

## 29. Repository workflow

Do not push feature work directly to `main` unless explicitly instructed. Normal flow: branch from current `main`, implement one coherent change, run verification, review the complete diff, open a PR to `main`, and merge only after review.

PR descriptions should state what changed, why, architectural decisions, migration implications, and verification performed.

## 30. PR review is system review

Review every PR against the repository as a system, not only the local task. Check this `AGENTS.md`, original requirements, Client/Coach effects, TypeScript/API contracts, Worker authorization/security, D1 data/schema, navigation/platform effects, tests/failure behavior, and obsolete paths.

Reject a PR that solves a local symptom by violating a system boundary. Review comments must identify the concrete problem and expected correction.

## 31. Definition of Done

A change is done only when all applicable conditions hold: requested behavior works; ownership is correct; Client/Coach boundaries remain valid; types/contracts are coherent; API boundaries are respected; backend authorization is enforced; persistence/migrations preserve integrity; failure paths are handled; Telegram/mobile compatibility was considered; obsolete paths are removed; tests are updated; relevant verification passes or limitations are documented; and the complete diff has been reviewed for regressions.
