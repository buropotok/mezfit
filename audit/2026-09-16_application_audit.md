# Mezfit application audit

- **Audit date:** 2026-09-16
- **Repository:** `buropotok/mezfit`
- **Audited branch:** `work`
- **Audited HEAD:** `6be5beda5f831644b85fa88304dbffb2a5a241d4`
- **Applied instructions:** `/workspace/mezfit/AGENTS.md` (the only `AGENTS.md` found; scope: the entire repository) and `typography.md` for the UI typography contract.
- **Scope:** current tracked application as a system: React client/coach surfaces, navigation and state ownership, typed API client, Worker routing/authentication/authorization/validation, D1 schema and migrations, Telegram Mini App integration, UIkit and CSS, workout/program/exercise flows, tests, dependencies, build tooling, and realistic failure/edge cases. Generated/untracked dependency contents were not treated as application source.

## Executive Summary

The repository has several sound foundations: Telegram `initData` is verified server-side, protected routes establish the actor and role, coach/client ownership checks generally live in the Worker, SQL is parameterized, workout initialization and program graph mutations use guarded/atomic D1 operations, and a substantial component/domain test corpus exists. Nevertheless, the current checkout is **not reproducibly verifiable or release-ready**. The committed lockfile is empty and disagrees with `package.json`, so a clean install fails and the mandatory typecheck, test, and build commands cannot run. The principal client workout implementation is also disconnected from the actual application shell, and nested navigation is not coordinated with Telegram BackButton or browser history.

The audit found **0 Critical, 4 High, 7 Medium, and 4 Low findings**. **11 findings are violations of one or more `AGENTS.md` requirements** (A-001, A-002, A-003, A-004, A-005, A-006, A-007, A-008, A-010, A-011, A-012). No production or test file was changed.

| Severity | Count |
| --- | ---: |
| Critical | 0 |
| High | 4 |
| Medium | 7 |
| Low | 4 |
| **Total** | **15** |
| **Findings violating AGENTS.md** | **11** |

## Findings

### Critical

No confirmed Critical findings.

### High

#### **[A-001] Clean installation and all mandatory verification are broken**

- **Severity:** High
- **Category:** AGENTS / Tests
- **File:** `package-lock.json`; `package.json`
- **Location:** `package-lock.json:1-7`; `package.json:17-38`
- **Requirement / expected behavior:** AGENTS §§24–25 require current tests and successful execution of `npm run typecheck`, `npm test`, and `npm run build` (or an accurately documented limitation). The lockfile must make the declared application reproducibly installable.
- **Current behavior:** `package-lock.json` declares version `0.0.1` and an empty `packages` map while `package.json` declares version `0.1.0` and many runtime/dev dependencies. `npm ci` exits with `EUSAGE` and reports all declared packages missing from the lockfile. Consequently, without pre-existing dependencies, typecheck cannot find `@cloudflare/workers-types`, test cannot find `vitest`, and build cannot find `vite`.
- **Reproduction/scenario:** In a clean checkout run `npm ci`, then any required verification command. Installation fails before CI can establish application correctness.
- **Why this is a problem:** Every clean CI/developer environment is unable to run the required quality gates or produce a build; dependency resolution is neither reproducible nor auditable.
- **Recommended fix:** In a dedicated dependency-integrity PR, regenerate and review `package-lock.json` from the intended, explicitly supported package versions; avoid unconstrained `latest` where reproducibility is required; then run all required checks from a clean install.
- **Related components/files:** CI workflow (not present in this checkout), `tsconfig.json`, `vite.config.ts`, all tests.
- **Test coverage:** This is exposed by the package manager itself; no repository test guards lockfile/package manifest consistency.

#### **[A-002] Implemented workout flow is unreachable from the production application**

- **Severity:** High
- **Category:** AGENTS / Bug / Architecture
- **File:** `src/App.tsx`; `src/workout/WorkoutSessionScreen.tsx`; `src/workout/index.ts`
- **Location:** `App.tsx:63-68,118-137,224-260`; `WorkoutSessionScreen.tsx:52-347`; `workout/index.ts:3`
- **Requirement / expected behavior:** The client experience must own the athlete workflow and connect UI intent through the typed API to authoritative persistence (AGENTS §§2–3, 6, 27, 31). A key implemented workflow must have a real production consumer or be removed as obsolete architecture.
- **Current behavior:** `WorkoutSessionScreen` implements draft initialization, program-day selection, set persistence, ordering, completion, errors, and lifecycle notifications, but it is referenced only by its tests and barrel export. Client `today` renders placeholder cards and never mounts the workout screen. No application route/destination starts or resumes a workout.
- **Reproduction/scenario:** Open the Mini App as a client, navigate through every client destination, including “Сегодня” and “Программа”. There is no control/path that mounts `WorkoutSessionScreen`, so an assigned active program cannot be performed despite the backend and UI module existing.
- **Why this is a problem:** The application's core athlete scenario is unavailable to real users; extensive implementation and tests give a false impression of integrated behavior.
- **Recommended fix:** In a focused integration PR, assign workout navigation/state to the client shell, mount the screen from a deliberate destination/action, wire lifecycle callbacks and back behavior, and add an App-level integration test. Do not bypass the existing typed API or Worker.
- **Related components/files:** `src/NavigationShell.tsx`, `src/api.ts:413-472`, `worker/lib/workout-session-api.ts`, `worker/lib/workout-sessions.ts`.
- **Test coverage:** Unit/component tests cover the isolated screen, but no test proves it is reachable through `App` or production navigation.

#### **[A-003] Nested navigation ignores Telegram BackButton and browser history**

- **Severity:** High
- **Category:** AGENTS / Architecture / Bug
- **File:** `src/NavigationShell.tsx`; `src/telegram.ts`; `src/App.tsx`; `src/coach/CoachShell.tsx`
- **Location:** `NavigationShell.tsx:19-22,89-108,110-201`; `telegram.ts:1-17`; `App.tsx:140-148,224-260`; `CoachShell.tsx:172-204`
- **Requirement / expected behavior:** AGENTS §14 requires one coordinated deterministic path for Telegram BackButton, browser history, in-app back controls, and nested transitions; §16 requires Telegram APIs behind a deliberate boundary.
- **Current behavior:** Nested state exposes only an in-app header callback. The Telegram abstraction contains `ready`, `expand`, and `disableVerticalSwipes`, but no BackButton contract. There is no `popstate`, `pushState`, or history integration. Refresh also resets all destinations/nested selections to initial state.
- **Reproduction/scenario:** Open coach Programs → a program detail (or Exercises → category/detail), then press Telegram's BackButton or Android/browser back. The app has registered no handler and no history entry, so the expected in-app transition is not performed and the host may close/navigate away from the Mini App.
- **Why this is a problem:** This is a direct platform-navigation regression in primary coach flows and conflicts with the project's explicit navigation infrastructure contract.
- **Recommended fix:** Extend the Telegram integration boundary with BackButton feature detection/subscription and cleanup, establish one navigation stack that also owns browser history, and test nested transitions, role switches, refresh, unmount, iOS, and Android behavior.
- **Related components/files:** `src/coach/GlobalExerciseCatalog.tsx:95`, `src/coach/CoachShell.tsx`, `src/client/ClientCoachSelectorModal.tsx`.
- **Test coverage:** `src/navigation.test.ts` checks artwork only; `src/telegram.test.ts` checks initial preparation only. No navigation lifecycle/history/BackButton test exists.

#### **[A-004] Dependency policy selects moving “latest” releases without a valid lock**

- **Severity:** High
- **Category:** AGENTS / Architecture / Tests
- **File:** `package.json`; `package-lock.json`
- **Location:** `package.json:25-38`; `package-lock.json:1-7`
- **Requirement / expected behavior:** Typed contracts and verification must remain stable and reviewable (AGENTS §§7, 24–25, 31). Dependency updates should be deliberate rather than silently changing compiler/framework/runtime behavior.
- **Current behavior:** React, React DOM, all major development tools, Wrangler, TypeScript, Vitest, and several type packages use the literal `latest`, while the lockfile contains no resolution. On 2026-09-16 npm attempted future/current major versions (including TypeScript 7, Vite 8, Vitest 5, React 19.3, Wrangler 4.132) that were not reviewed in this commit.
- **Reproduction/scenario:** Regenerate/install dependencies on two different dates; `latest` may resolve different major versions, changing type rules, build output, test semantics, Worker behavior, or browser support even though application source is unchanged.
- **Why this is a problem:** It compounds A-001 and makes any eventual regenerated lockfile a potentially large, unreviewed platform migration.
- **Recommended fix:** Separately choose supported version ranges/versions, document Node/npm expectations, generate the lockfile, and review/test dependency upgrades independently from feature work.
- **Related components/files:** `tsconfig.json`, `vite.config.ts`, `wrangler.jsonc`.
- **Test coverage:** No dependency-policy or clean-install check is committed.

### Medium

#### **[A-005] Concurrent workout mutations can overwrite newer authoritative UI state**

- **Severity:** Medium
- **Category:** AGENTS / Bug / Architecture
- **File:** `src/workout/WorkoutSessionScreen.tsx`
- **Location:** `WorkoutSessionScreen.tsx:120-140` (`handleSaveSet`); `142-171` (`handleReorder`); `173-190` (`handleComplete`)
- **Requirement / expected behavior:** AGENTS §15 requires the initiator to own stale completion and repeated actions; old requests must not overwrite newer authoritative state. §18 requires persisted and visual ordering to reconcile deterministically.
- **Current behavior:** Reorders are versioned/serialized among themselves, but a set save installs its full-session response unconditionally and is not coordinated with the reorder queue. Each endpoint returns a complete projection. A slower save response can therefore replace a later optimistic/acknowledged exercise order; conversely a reorder projection can replace newly saved set data depending on request interleaving.
- **Reproduction/scenario:** On a slow network, save a set and immediately reorder exercises (or reorder while a save is in flight). If the earlier server projection resolves last, `setSession(nextSession)` installs data captured before the other mutation.
- **Why this is a problem:** The UI can temporarily regress persisted facts/order and show a state different from D1 until reload; subsequent user actions are based on that stale projection.
- **Recommended fix:** Give all full-session mutations a shared monotonic reconciliation/version owner or merge only mutation-specific canonical fields; invalidate/refetch after conflicting operations. Preserve rollback for the order operation.
- **Related components/files:** `src/api.ts:433-472`, `worker/lib/workout-sessions.ts` save/reorder projections.
- **Test coverage:** Existing workout tests cover repeated reorder rollback but not save-vs-reorder, complete-vs-save, stale success, or unmount/navigation-away interleavings.

#### **[A-006] Theme fetch blocks first render for up to five seconds**

- **Severity:** Medium
- **Category:** AGENTS / Performance
- **File:** `src/main.tsx`; `src/theme.ts`
- **Location:** `main.tsx:24-36`; `theme.ts:23-55`
- **Requirement / expected behavior:** AGENTS §22 requires startup to focus on shell/first-screen requirements and a noncritical feature failure not to prevent the shell from working.
- **Current behavior:** `bootstrap` awaits `loadGlobalTheme()` before calling `createRoot(...).render`. The theme request timeout is 5000 ms. During slow/stalled `/api/config`, neither the usable default-theme shell nor an application loading state is mounted.
- **Reproduction/scenario:** Open/reopen the Mini App with a slow network or a response whose body stalls. The root remains blank for up to five seconds even though the code explicitly treats the default theme as usable without the endpoint.
- **Why this is a problem:** A noncritical appearance setting delays the entire product and worsens WebView first-open/reopen behavior.
- **Recommended fix:** Apply the default synchronously and render the shell immediately; load and validate the global theme asynchronously under a lifecycle owner, avoiding disruptive post-render flashes where possible.
- **Related components/files:** `src/bootDiagnostics.ts`, `index.html`, `src/theme.css`.
- **Test coverage:** `theme.test.ts` verifies timeout/fallback behavior but not time-to-first-render or that App renders before configuration completes.

#### **[A-007] Existing Telegram user profile data is never refreshed**

- **Severity:** Medium
- **Category:** AGENTS / Bug / Data
- **File:** `worker/index.ts`
- **Location:** `resolveUser`, lines 93-135, especially early return at line 104
- **Requirement / expected behavior:** Canonical server state should be reconciled from validated inputs and avoid indefinitely stale duplicated mutable state (AGENTS §§6, 10, 16).
- **Current behavior:** Once `app_user` exists, `resolveUser` returns the stored row without updating validated Telegram `username`, names, language, photo URL, or premium flag.
- **Reproduction/scenario:** A user changes their Telegram name, username, profile photo, language, or premium status and then repeatedly reopens Mezfit. `/api/me`, coach/client lists, avatars, and labels continue returning the original values forever.
- **Why this is a problem:** User-facing identity becomes permanently stale and can retain obsolete personal data. Other users see incorrect identity information.
- **Recommended fix:** After signature/timestamp validation, perform a parameterized, scoped profile refresh (with an explicit data-retention policy) and return the canonical updated row; test changed optional/null fields and concurrent first login.
- **Related components/files:** `migrations/0001_users_and_roles.sql`, coach/client list routes, `userView`.
- **Test coverage:** `worker/user-bootstrap.test.ts` explicitly freezes the current “existing user before write” implementation rather than testing current profile reconciliation; that test should be reconsidered only with a separate user-approved behavior change.

#### **[A-008] Feature CSS reaches into UIkit private class structure**

- **Severity:** Medium
- **Category:** AGENTS / UIkit / Architecture
- **File:** `src/coach/program-details.css`; `src/coach/programs.css`; `src/program/program-phase-card.css`; `src/workout/session-exercise.css`; `src/workout/set-entry.css`; `src/global-exercise.css`; `src/exercise.css`
- **Location:** Examples: `program-details.css:28,37-51,91`; `programs.css:8-9,16,22-24`; `session-exercise.css:22,83-87,145`; `set-entry.css:1,51,225-251,291-333`; `global-exercise.css:49,51,61-62`
- **Requirement / expected behavior:** AGENTS §19 prohibits coupling domain logic/presentation to third-party/private component DOM and requires using supported primitives/settings instead of bypassing UIkit mechanics or visual presentation.
- **Current behavior:** Feature styles select UIkit internals such as `.ui-modal__dialog`, `.ui-list-item-wrap`, `.ui-text-input__field`, `.ui-badge`, `.ui-button`, and `.ui-fab`, relying on the primitive's private DOM and class layout. Several rules alter dimensions, padding, borders, active presentation, or descendants rather than consuming explicit component variants/slots.
- **Reproduction/scenario:** Refactor the internal markup/class of `Modal`, `ListItem`, `TextInput`, `Badge`, or `FloatingActionButton` without changing its public API. Multiple feature screens silently lose separators, sizing, modal width, or selected state.
- **Why this is a problem:** UIkit is no longer a stable presentation boundary; feature screens effectively fork/override primitive visuals and create cross-component regression risk.
- **Recommended fix:** Add narrowly designed public variants/props/tokens to UIkit only where product requirements are genuinely shared, or wrap primitives with feature-owned layout that does not inspect private descendants. Migrate each independent surface in focused PRs; do not apply hidden CSS hacks.
- **Related components/files:** `src/ui/components.tsx`, `src/ui/primitives.tsx`, UIkit CSS.
- **Test coverage:** UIkit tests cover semantics and a few variants, not resistance to feature-level private-selector coupling or visual regression.

#### **[A-009] Client program-load failures have no retry path**

- **Severity:** Medium
- **Category:** Bug
- **File:** `src/client/ClientProgramsPage.tsx`; `src/client/ClientCoachContext.tsx`
- **Location:** `ClientProgramsPage.tsx:16-77`; `ClientCoachContext.tsx:32-103`
- **Requirement / expected behavior:** A recoverable network error should expose deterministic recovery without forcing an application restart.
- **Current behavior:** Both coach-list and program-list errors render static `ListItem` messages. Although the context exposes `refreshCoaches`, the error UI does not call it, and there is no retry key/action for `getClientPrograms`.
- **Reproduction/scenario:** Open “Программа” during a transient offline/5xx response, then restore connectivity. The page remains in its error state indefinitely unless the user changes role/reloads/reopens the Mini App.
- **Why this is a problem:** A temporary network error becomes a session-long failure for a primary client surface.
- **Recommended fix:** Add explicit retry actions owned by the failing request, retaining the selected valid coach and guarding stale responses.
- **Related components/files:** `src/api.ts:getClientPrograms/getClientCoaches`, `src/client/ClientCoachSelectorModal.tsx`.
- **Test coverage:** No tests exist for client coach/program loading, empty state, retry, stale response, invalid auth, or coach removal.

#### **[A-010] Application/runtime API responses are trusted by TypeScript casts only**

- **Severity:** Medium
- **Category:** AGENTS / Architecture
- **File:** `src/api.ts`; `src/theme.ts`
- **Location:** `apiRequest<T>` at `api.ts:210-231`; all typed endpoint wrappers; `theme.ts:34`
- **Requirement / expected behavior:** AGENTS §§7 and 10 require explicit boundary types plus runtime validation of untrusted input; malformed backend/legacy data must not be hidden by assertions.
- **Current behavior:** Successful JSON is returned directly as generic `T` with no schema/shape validation. Error JSON is cast to `ApiErrorPayload`. Callers immediately access arrays/nested fields and call `.map`/`.find`. Only the theme value receives narrow normalization after a cast.
- **Reproduction/scenario:** A partial deployment, proxy/error page incorrectly marked 200, malformed JSON value, or legacy nullable field returns a shape such as `{ programs: null }`; the UI throws at `.map`/`.filter` rather than producing the established local error state.
- **Why this is a problem:** Compile-time types provide false safety at the trust boundary and malformed responses can crash individual screens.
- **Recommended fix:** Introduce endpoint-specific decoders/type guards at the API layer with normalized `ApiError` failures. Start with authentication, program, coach/client lists, and workout session projections.
- **Related components/files:** all React consumers and Worker response contracts.
- **Test coverage:** No API-client malformed-success-response tests exist.

#### **[A-011] Duplicate migration version prefix makes schema history ambiguous**

- **Severity:** Medium
- **Category:** AGENTS / Architecture / Data
- **File:** `migrations/0014_archive_legacy_exercise_seed.sql`; `migrations/0014_gym_keeper_russian_names.sql`
- **Location:** filenames and complete migration bodies
- **Requirement / expected behavior:** AGENTS §12 requires an ordered, versioned, append-only D1 migration history whose deployment compatibility can be reviewed.
- **Current behavior:** Two distinct deployed-intent migrations share version `0014`. Even if Wrangler tracks full filenames and happens to order them lexically, human/tooling assumptions about a unique monotonically increasing version are broken.
- **Reproduction/scenario:** An operator or auxiliary migration tool asks which schema/data operation is migration 0014, or ordering is reconstructed by numeric prefix; there are two answers, and follow-up migration planning can target the wrong state.
- **Why this is a problem:** Schema history and operational communication are ambiguous. Existing deployed migrations must not simply be renamed, so the ambiguity now needs explicit documentation/forward handling.
- **Recommended fix:** Do not rewrite deployed files. Document the duplicate in migration history and adopt a validated unique naming rule for all future migrations; add a migration-filename consistency check.
- **Related components/files:** `wrangler.jsonc`, deployment documentation.
- **Test coverage:** No test/check enforces unique migration numeric prefixes or applies the full chain from an empty local D1 database in this audit environment.

### Low

#### **[A-012] Existing UIkit primitives are duplicated by raw feature controls**

- **Severity:** Low
- **Category:** AGENTS / UIkit
- **File:** `src/coach/ExerciseCatalog.tsx`; `src/coach/GlobalExerciseCatalog.tsx`; `src/App.tsx`
- **Location:** `ExerciseCatalog.tsx:136-138`; `GlobalExerciseCatalog.tsx:86-109`; `App.tsx:215-218`
- **Requirement / expected behavior:** AGENTS §19 says to use existing primitives/patterns before parallel implementations.
- **Current behavior:** `ExerciseCatalog` and `GlobalExerciseCatalog` hand-build search inputs despite `SearchInput` existing; global catalogue toolbar/details hand-build square icon buttons despite `IconButton`; first-run choices hand-build buttons rather than a documented Button/list selection variant.
- **Reproduction/scenario:** Compare focus/clear/press/disabled behavior between the UIkit catalog and these production surfaces. Feature controls do not automatically inherit UIkit interaction improvements.
- **Why this is a problem:** Parallel controls increase visual/accessibility drift and maintenance cost.
- **Recommended fix:** Replace only where the existing public primitive meets UX. Where it does not, first specify and add a supported UIkit variant rather than styling internal classes.
- **Related components/files:** `src/ui/SearchInput.tsx`, `src/ui/primitives.tsx`, `src/ui/UiKitPage.tsx`.
- **Test coverage:** `SearchInput` and primitive tests exist, but no production-surface conformance test exists.

#### **[A-013] Program client selection can fail silently on navigation-away races**

- **Severity:** Low
- **Category:** Bug
- **File:** `src/coach/CoachShell.tsx`; `src/coach/ProgramsPage.tsx`
- **Location:** `CoachShell.tsx:172-181,235-250`; `ProgramsPage.tsx:218-226`
- **Requirement / expected behavior:** Superseded async actions should have deliberate user-visible cancellation/stale behavior.
- **Current behavior:** The request counter correctly prevents a late client-list response from navigating after destination change. However, a superseded `selectProgramClient` resolves successfully without selecting anything; `ProgramsPage` therefore has no error/message and the user's click appears to do nothing.
- **Reproduction/scenario:** On a slow uncached `getCoachClients`, tap a client program then immediately navigate elsewhere/back so the counter changes. The promise resolves as success but suppresses selection with no feedback.
- **Why this is a problem:** Cancellation is technically safe but not explicit to the initiator; the action has an unexplained no-op outcome.
- **Recommended fix:** Model cancellation distinctly or ensure the initiating screen unmounts/owns pending state so no stale success is interpreted as completed navigation.
- **Related components/files:** `src/NavigationShell.tsx`.
- **Test coverage:** No slow-request/navigation-away test for this flow.

#### **[A-014] Global exercise detail can display stale data after an out-of-order request**

- **Severity:** Low
- **Category:** Bug
- **File:** `src/coach/GlobalExerciseCatalog.tsx`
- **Location:** `openInfo`, line 98; detail navigation effect line 95
- **Requirement / expected behavior:** Detail async ownership should reject stale completions.
- **Current behavior:** `openInfo` immediately selects a row, requests full details, and unconditionally installs the returned exercise. It has no request id/cancellation check. The user can navigate back and open a different item before the first request completes.
- **Reproduction/scenario:** On slow network, open exercise A, go back, open B; if A's request resolves last, the detail view changes from B to A unexpectedly.
- **Why this is a problem:** The user sees and may edit/favourite the wrong exercise after a realistic rapid-navigation sequence.
- **Recommended fix:** Scope detail loading to selected ID using a cancellable effect or request generation, and install only a response matching the current selection.
- **Related components/files:** `src/api.ts:getCoachExercise`, navigation context.
- **Test coverage:** The catalogue test checks superseded list searches, not superseded detail requests.

#### **[A-015] No lint/static-style command is defined**

- **Severity:** Low
- **Category:** Tests / Other
- **File:** `package.json`
- **Location:** scripts at lines 6-15
- **Requirement / expected behavior:** The task requested all repository-defined checks, including lint where available; maintainable code benefits from a declared static quality gate.
- **Current behavior:** There is no `lint` script or lint configuration. This audit could not run a repository lint command. Dense one-line production code and `any` in `worker/lib/exercise-media.ts` are therefore not automatically rejected.
- **Reproduction/scenario:** Run `npm run lint`; npm reports a missing script (not executed as a formal check because the repository does not claim one).
- **Why this is a problem:** Contract-breaking broad types/style regressions have no dedicated automated gate beyond TypeScript, which itself is currently blocked by A-001.
- **Recommended fix:** Add a deliberately configured lint/static-analysis gate in a separate tooling PR after dependency integrity is restored; prohibit explicit `any` at architectural boundaries without rewriting behavior merely to satisfy formatting.
- **Related components/files:** `worker/lib/exercise-media.ts:20,23`, all TypeScript/TSX.
- **Test coverage:** N/A.

## AGENTS.md compliance matrix

The matrix covers every substantive numbered requirement. “Evidence” is representative, not an assertion that unlisted code was ignored.

| Requirement | Status | Evidence | Related findings |
| --- | --- | --- | --- |
| §1 Preserve architecture / trace owners | PARTIAL | Clear domain folders and API wrappers exist, but the completed workout slice has no production owner/consumer. | A-002 |
| §2 Canonical layered architecture | PARTIAL | React generally calls `src/api.ts`, Worker owns SQL; runtime response decoding is absent. | A-010 |
| §3 Client/Coach boundary | PASS | Separate shells/surfaces; client programs are selected-coach assignments; Worker verifies active relationship for coach/client resources. | — |
| §4 Single responsibility | PASS | API, Telegram, UI, program, workout, and persistence responsibilities are mostly separated; no dumping-ground module found. | — |
| §5 React boundaries | PASS | No cross-component DOM scraping/global event state channel found; effects reviewed generally clean up local timers/request relevance flags. | — |
| §6 One authoritative state owner | PARTIAL | Canonical mutation responses are used, but full-session concurrent responses can regress newer state; existing Telegram profile is duplicated indefinitely. | A-005, A-007 |
| §7 TypeScript contracts | FAIL | Types are explicit internally, but successful HTTP payloads cross the boundary via unchecked generic assertions. | A-010 |
| §8 Frontend API boundary | PASS | Feature requests use `src/api.ts`; only startup theme config fetches directly in its deliberate integration module. No monkey-patching found. | — |
| §9 Worker trust boundary | PASS | `requireUser`, `requireRole`, relationship and program-owner checks are server-side; workout resources filter by authenticated user. | — |
| §10 Validation/error contracts | PARTIAL | Worker validates most JSON/IDs and returns stable errors; frontend does not validate successful response shapes. | A-010 |
| §11 D1 persistence/invariants | PASS | Parameterized SQL, stable IDs, guarded status mutations, and `db.batch` are used for multi-record graph operations. | — |
| §12 Versioned migrations | PARTIAL | Append-only migrations exist, but two different migrations use prefix 0014 and full-chain verification was blocked. | A-011, A-001 |
| §13 Structured data contracts | PASS | IDs and typed structured records cross layers; no DOM/display-string transport contract found. | — |
| §14 Navigation infrastructure | FAIL | In-app callback exists, but Telegram BackButton/browser history/refresh are not coordinated. | A-003 |
| §15 Async ownership | PARTIAL | Many effects use cancellation flags and reorder has rollback, but cross-mutation workout responses and detail loading allow stale completion. | A-005, A-013, A-014 |
| §16 Telegram boundary | PARTIAL | Telegram preparation is isolated and server authentication verifies `initData`; BackButton is absent. | A-003 |
| §17 iOS/Android compatibility | PARTIAL | Safe-area/dynamic viewport/touch DnD considerations exist; host/back lifecycle remains incomplete. | A-003 |
| §18 Drag/order ownership | PARTIAL | Stable IDs, API persistence, validation, serialization, rollback and touch sensors exist; save/reorder projections can still diverge transiently. | A-005 |
| §19 UI libraries/CSS | FAIL | UIkit is broadly used but raw duplicates and selectors into primitive internals remain. | A-008, A-012 |
| §20 Import-time code/globals | PARTIAL | No network request begins merely on module import; boot runtime uses a mutable `window.__MEZFIT_BOOT__` registry with a narrow interface but no repository ownership documentation was found. | — |
| §21 Security/secrets | PASS | No committed bot token/API credential found; Telegram signatures are verified; errors avoid stack/SQL/token exposure. | — |
| §22 Performance/failure isolation | FAIL | Theme configuration blocks all rendering for up to five seconds. | A-006 |
| §23 Idempotency/cleanup | PASS | User creation/start/init are guarded/idempotent; effects/timers/observers reviewed include cleanup. | — |
| §24 Tests protect architecture | PARTIAL | Strong isolated UI/domain tests exist, but integration, navigation, failure and stale-concurrency gaps remain; existing-user test protects stale profile behavior. | A-002, A-003, A-005, A-007, A-009, A-010, A-013, A-014 |
| §25 Required verification | FAIL | Commands were invoked, but clean install is impossible and none of typecheck/test/build completed successfully. | A-001, A-004 |
| §26 Debugging/regressions | N/A | Process rule for changes; this audit changed no production behavior. | — |
| §27 Delete obsolete architecture | FAIL | Workout implementation is neither integrated nor removed and therefore has no real production consumer. | A-002 |
| §28 Change scope | PASS | This commit is limited to one new audit artifact. | — |
| §29 Repository workflow | N/A | This task explicitly requested an audit-only commit and no PR; no remote is configured. | — |
| §30 PR review as system review | N/A | No PR is part of the requested audit workflow; this document performs a system review. | — |
| §31 Definition of Done | FAIL | Key client workout is unavailable and mandatory verification cannot run. | A-001, A-002, A-003 |
| §32 GitHub connector safe updates | N/A | The GitHub connector was not used; only a new local Markdown file was created. | — |
| `typography.md` | PARTIAL | Shared tokens/semantic Text roles are prevalent and no normal text below caption was confirmed; legacy/custom controls and feature selectors weaken consistent ownership. | A-008, A-012 |

## Test results

### `npm ci`

- **Result:** FAIL (`EUSAGE`, exit 1).
- **Failures:** `package.json` and `package-lock.json` are not in sync; npm lists every declared direct/transitive dependency as missing from the lockfile.
- **Warnings:** npm warns that the environment's `http-proxy` config is unknown and will stop working in the next npm major version.
- **Relevant observations:** The lockfile is only seven lines with an empty `packages` object. A later best-effort `npm install --no-audit --no-fund` was stopped after it failed to make useful progress in the available environment; its temporary lockfile changes and `node_modules` were removed. It is not reported as a passed check.

### `npm run typecheck`

- **Result:** FAIL (exit 2).
- **Failures:** TypeScript reports `TS2688: Cannot find type definition file for '@cloudflare/workers-types'` because dependencies cannot be installed from the committed lockfile.
- **Warnings:** Same npm `http-proxy` warning.
- **Relevant observations:** The command actually ran twice (before and after the failed `npm ci` attempt) with the same failure. This does not establish whether application types would pass with a corrected dependency graph.

### `npm test`

- **Result:** FAIL (exit 127).
- **Failures:** `sh: 1: vitest: not found` because dependency installation failed.
- **Warnings:** Same npm `http-proxy` warning.
- **Relevant observations:** The command actually ran twice with the same failure. Zero tests executed, so no test suite is claimed as passing.

### `npm run build`

- **Result:** FAIL (exit 127).
- **Failures:** `sh: 1: vite: not found` because dependency installation failed.
- **Warnings:** Same npm `http-proxy` warning.
- **Relevant observations:** The command actually ran twice with the same failure. No production bundle was produced.

### Lint

- **Command:** Not available; `package.json` defines no lint script.
- **Result:** NOT RUN.
- **Failures/warnings:** Repository tooling gap recorded as A-015.
- **Relevant observations:** The audit does not claim lint passed.

### Wrangler/local migrations

- **Command:** `npm run db:migrate:local` was identified from `package.json` but not run because `wrangler` could not be installed from the invalid lockfile.
- **Result:** NOT RUN (environment/repository dependency limitation).
- **Failures/warnings:** Full empty-database migration-chain behavior remains unverified.
- **Relevant observations:** No Worker/D1 source was changed by this audit.

## Missing test coverage

1. App-level first-run → role → client Today → initialize/start/save/complete workout integration (currently it would reveal A-002).
2. Telegram BackButton, browser/Android back, history, nested coach/client transitions, role switch, modal precedence, refresh restoration, handler cleanup, and clients without BackButton support.
3. Clean `npm ci` and full required-check execution in a clean environment; unique migration filenames and full local migration chain from empty D1.
4. Client coach/program slow network, empty list, retry, coach removal, selected-coach persistence, malformed response, 401/expired auth, and navigation away.
5. Workout save-vs-reorder, save-vs-complete, duplicate saves, stale success/error, cancellation/unmount, lost response, malformed projection, and reconnect/reload recovery.
6. Worker HTTP-level authorization matrix: wrong role, unlinked coach/client, changed IDs, inactive relationship, missing resources, malformed bodies, and cross-user workout IDs. Domain SQL tests do not replace route-level tests.
7. Existing Telegram profile refresh, optional fields changing to null, concurrent first login, and data-retention behavior.
8. Global exercise detail A→back→B request ordering; favourite/edit/archive races and retry.
9. API client runtime decoding of invalid JSON, valid JSON with invalid shapes/nulls, empty 204 success, and stable error normalization.
10. First paint while `/api/config` is slow/stalled/offline; Mini App reopen lifecycle; WebKit/Android viewport/keyboard/safe-area behavior.
11. UIkit conformance/visual regression for feature overrides, touch/focus behavior, and narrow Mini App widths.
12. D1 concurrency tests against an actual local database for invitation acceptance, program position allocation/reordering, phase create/delete, and workout mutations; current mock-based query tests cannot prove SQLite constraints/transaction semantics end-to-end.

## UIkit gaps

The audit distinguishes **missing public capability** from permission to override internals. No hidden CSS/JS workaround is recommended.

1. **Feature-scoped modal sizing:** screens currently set `.ui-modal__dialog` widths through descendant selectors. UIkit lacks a documented `size`/`maxWidth` variant for editor and set-entry dialogs. Add a finite, reviewed size API if these widths are product requirements.
2. **List separators/insets:** several surfaces synthesize separators by targeting `.ui-list-item-wrap`. UIkit lacks a public separator/inset policy on `List`; expose a supported variant rather than depending on internal wrappers.
3. **Selected icon/button state:** catalogue and workout screens hand-style active square/icon/RPE controls. `IconButton`/`Button` lack a general public pressed/selected visual variant tied to `aria-pressed`.
4. **Search adornment/layout:** `SearchInput` has its own icon/clear behavior, but the category-first catalogue needs a compact toolbar/search presentation. If the existing primitive cannot meet that layout, define a supported compact/adornment parameter; do not rebuild it with raw input plus CSS.
5. **Numeric stepper field:** `SetEntry` reaches into `TextInput` internals to hide WebKit spinners and compose +/- controls. UIkit has no numeric-stepper primitive/slot contract. A dedicated accessible `NumberStepper` is preferable to descendant overrides.
6. **FAB icon geometry:** multiple features size child SVGs via `.ui-fab` descendants. UIkit should own standard icon geometry or expose an explicit size slot/variant.

These gaps do not justify changing Radix/dnd-kit mechanics or silently restyling UIkit internals. Each addition should preserve the primitive's documented behavior and receive component-level tests.

## Recommended remediation order

1. **Restore the verification foundation (A-001, then A-004).** Use a dedicated dependency/tooling PR: select supported versions, regenerate/review the lockfile, run a clean install, then establish the actual baseline for typecheck/tests/build. Do not mix application fixes into this PR.
2. **Integrate the core athlete workflow (A-002) after verification works.** First define its navigation owner and production entry point; add App-level integration coverage. This should not be combined with unrelated exercise/UIkit work.
3. **Establish navigation infrastructure (A-003).** Coordinate application stack, Telegram BackButton, browser history, modals, cleanup, and refresh semantics before layering more nested flows onto the current callbacks.
4. **Fix authoritative async reconciliation (A-005) and add cross-mutation tests.** Do this before exposing the workout screen broadly, since integration will increase the likelihood of the race.
5. **Add runtime response validation (A-010).** Begin with `/api/me`, coach/client/program lists, and workout projections; this creates a safer basis for subsequent UI error/retry work.
6. **Make startup nonblocking (A-006).** Treat theme as recoverable enhancement and test first render independently from configuration latency.
7. **Define and implement Telegram profile reconciliation (A-007).** This is a separate data-policy/behavior PR; explicitly review the existing test before changing it, as AGENTS §24 requires user approval before correcting a test that protects removed/deprecated behavior.
8. **Add client retries and stale-detail handling (A-009, A-013, A-014)** as separate ownership-focused fixes with slow-network/navigation-away tests.
9. **Evolve UIkit public APIs, then migrate consumers (A-008, A-012).** Treat each primitive gap as a UIkit change with tests, followed by small feature migrations. Never replace private selectors with different hacks.
10. **Document/enforce migration naming (A-011)** without renaming deployed migrations; add the full-chain local D1 check once Wrangler installation is restored.
11. **Add deliberate lint/static analysis (A-015)** only after versions and lockfile are stable, in its own tooling PR.

## Self-review record

- Re-read every finding against the cited implementation and removed speculative concerns without a realistic scenario.
- Severity was calibrated to observed impact: no unproven data loss/security issue was labeled Critical; reproducible release/key-flow blockers are High; bounded runtime/architecture defects are Medium/Low.
- Reviewed the full test inventory for current intent and obvious obsolete assumptions. The existing-user bootstrap test is specifically called out because it protects behavior that conflicts with profile freshness; this audit does **not** modify it.
- Confirmed recommendations preserve Worker authorization, D1 ownership, typed API boundaries, client/coach separation, React ownership, and UIkit public mechanics.
- Confirmed the report does not recommend CSS/JS hacks to alter UIkit internals; missing capabilities are isolated under **UIkit gaps**.
- Reconciled all command claims with captured exit codes; no failed or unexecuted command is represented as passing.
- Confirmed with `git status`/`git diff` before commit that the only intended repository change is this new file under `audit/`; production code, tests, configuration, dependencies, and migrations remain unchanged.
