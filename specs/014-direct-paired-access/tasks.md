# Tasks: Direct Paired Mobile Access

**Input**: Design documents from `/specs/014-direct-paired-access/`

**Prerequisites**: `plan.md`, `spec.md`, `research.md`, `data-model.md`, `contracts/`, `quickstart.md`

**Tests**: Contract, state-machine, security, persistence, lifecycle, integration, and packaging tasks are required. Tests are written before their corresponding implementation. Per repository instruction, do not add or run UI/DOM/Hook render tests or UI interaction smoke tests; desktop/mobile UI changes receive static review only.

**Organization**: Tasks are grouped by user story. Spec 013 is preserved as historical evidence while this feature replaces its account/Relay topology.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run independently in different files after its phase prerequisites are complete
- **[Story]**: Maps the task to the corresponding independently testable user story
- Every implementation task names concrete repository paths and is checked only after its focused validation passes

## Phase 1: Setup and Migration Baseline

**Purpose**: Preserve the validated business capability, establish the superseding feature, and record the exact migration baseline without altering unrelated worktree changes.

- [x] T001 Record branch, dirty-worktree ownership, current remote package/app inventory, package count, and passing Spec 013 HPKE/command/projection/ledger/replay/mobile-storage focused tests in `specs/014-direct-paired-access/validation.md`; explicitly preserve unrelated modifications and the no-UI-test constraint
- [x] T002 Update `specs/013-mobile-remote-control/spec.md`, `plan.md`, and `validation.md` with a concise superseded-by-Spec-014 notice without rewriting its completed historical evidence
- [x] T003 [P] Create the target `packages/server/remote-control-direct-server/package.json`, `tsconfig.json`, `README.md`, `README.zh-CN.md`, explicit exports, `src/`, `lib/`, and `tests/` skeleton using pnpm workspace conventions; do not add placeholder helpers or copy Relay provider code
- [x] T004 [P] Verify `.gitignore`, package publish ignores/config, root pnpm workspace inclusion, and existing generated native/build exclusions cover the new package and direct-access artifacts; change ignore files only for a demonstrated missing critical pattern

---

## Phase 2: Foundational Direct Trust and Protocol

**Purpose**: Define the account-free wire, endpoint, identity, and persistence boundaries that block every user story.

**⚠️ CRITICAL**: No user-story implementation begins until this phase passes.

### Tests first

- [x] T005 [P] Add strict direct pairing, endpoint, challenge/authentication, sealed-envelope, version, expiry, size/depth, unknown-field, and account/Relay-field rejection tests in `packages/contracts/remote-control-contracts/tests/direct-protocol.test.ts`
- [x] T006 [P] Add RFC1918, CGNAT/Tailscale, IPv6 ULA, `.local`, `.ts.net`, single-label, public, wildcard, multicast, unspecified, link-local, URL-injection, and port-boundary tests in `packages/server/remote-control-direct-server/tests/address-policy.test.ts`
- [x] T007 [P] Add connection-profile identity pinning, endpoint priority/edit, state transition, reconnect suppression, and no-account boot tests in `packages/transport/remote-control-client/tests/direct-profile.test.ts`
- [x] T008 [P] Extend `scripts/check-remote-control-boundaries.test.mjs` and `scripts/remote-control-privacy-audit.test.mjs` with failing fixtures for OAuth/OIDC/account tokens, Relay/PostgreSQL/push imports, public endpoint grammar, direct secrets/challenges/ciphertext, and excluded capabilities

### Implementation

- [x] T009 Implement `DirectEndpointV1`, direct pairing/hello/claim/result, direct challenge/authenticated frames, account-free device authorization, direct envelope headers, stable direct errors, and closed unions in `packages/contracts/remote-control-contracts/src/protocol.ts` and `src/pairing.ts`
- [x] T010 Implement strict parsers, canonical transcript/associated-data encoding, UTF-8 budgets, and explicit rejection of legacy account/Relay security fields in `packages/contracts/remote-control-contracts/src/codecs.ts`, `lib/bounds.ts`, and `lib/canonical-json.ts`; keep existing business command/query/result/event/snapshot codecs
- [x] T011 Implement canonical host/port/endpoints, private/Tailscale classification, socket URL derivation, and display-safe endpoint formatting in `packages/server/remote-control-direct-server/src/lib/address.ts` and `src/address-policy.ts`
- [x] T012 Implement direct server ports/types and bounded error/redaction/rate helpers in `packages/server/remote-control-direct-server/src/ports.ts`, `src/types.ts`, `src/errors.ts`, `src/lib/limits.ts`, and `src/lib/redaction.ts`
- [x] T013 Replace account-centric reusable client types with installation/profile/direct connection types and state transitions in `packages/transport/remote-control-client/src/types.ts`, `src/ports.ts`, `src/connection.ts`, `src/profiles.ts`, `src/endpoint-policy.ts`, and `lib/protocol-version.ts` while preserving cursor/operation/session behavior
- [x] T014 Update explicit public exports and bilingual boundary documentation in `packages/contracts/remote-control-contracts/package.json`, `src/index.ts`, `README.md`, `README.zh-CN.md`, `packages/transport/remote-control-client/package.json`, `src/index.ts`, `README.md`, and `README.zh-CN.md`; validate all three foundational package typechecks/tests

**Checkpoint**: Direct protocol, endpoint policy, account-free state, and security fixtures pass without any desktop/mobile product composition.

---

## Phase 3: User Story 1 — Pair Directly Without an Account (Priority: P1) 🎯 MVP

**Goal**: A desktop-disabled-by-default direct gateway can pair a fresh phone by QR or manual host/port/code, require matching safety-code confirmation, persist one revocable phone authorization locally, and use no account or external service.

**Independent Test**: Enable one loopback test listener, pair by QR and by manual fallback in separate runs, compare/confirm safety codes through the desktop approval port, restart persisted authorization state, and prove unauthenticated/expired/reused/denied/locked claims cannot read business data.

### Tests first

- [x] T015 [P] [US1] Add pairing invitation, QR/manual claim, transcript/safety code, five-attempt limit, expiry, concurrent reuse, denial, confirmation, persistence failure, and restart invalidation tests in `packages/server/remote-control-direct-server/tests/pairing-service.test.ts`
- [x] T016 [P] [US1] Replace mobile OAuth-pairing tests with QR/manual endpoint/code, HPKE claim, safety wait, cancellation, partial SecureStore/SQLite failure, and confirmed commit-order tests in `apps/mobile/tests/direct-pairing.test.ts`
- [x] T017 [P] [US1] Add Electron encrypted installation/config/paired-phone storage, disabled default, corrupt-data fail-closed, and renderer-copy redaction tests in `apps/desktop-electron/test/remote-control-lifecycle.test.cjs`

### Implementation

- [x] T018 [US1] Implement in-memory single-use invitation state, QR/manual verifiers, canonical claim verification, safety-code approval, persist-before-confirm authorization, rejection, cancellation, and bounded status views in `packages/server/remote-control-direct-server/src/pairing-service.ts`
- [x] T019 [US1] Implement pre-auth direct socket admission, pairing hello/claim/result sequencing, byte/frame/time/attempt/connection limits, generic close reasons, and post-confirm handoff in `packages/server/remote-control-direct-server/src/gateway.ts` and `src/socket-session.ts`
- [x] T020 [US1] Replace mobile account-bound pairing with direct QR/manual parsing, per-computer signing/HPKE identity, encrypted claim, safety wait, and atomic confirmed-profile commit in `apps/mobile/src/features/direct-pairing.ts`, `src/state/direct-pairing-transport.ts`, and `src/state/connection-profile-store.ts`
- [x] T021 [US1] Replace Electron machine credential storage with encrypted desktop installation identity, direct configuration, and persisted paired-phone authorizations in `apps/desktop-electron/src/desktop-services.cjs`
- [x] T022 [US1] Compose direct pairing state and approval callbacks into the Electron bridge generation in `apps/desktop-electron/src/desktop-remote-control.cjs`, without starting a listener while disabled or exposing the Runtime connection
- [x] T023 [US1] Replace account/Relay pairing IPC DTOs with bounded direct describe/interfaces/configure/create/get/confirm/reject/cancel/device/revoke/reset methods in `apps/desktop-electron/src/desktop-renderer-protocol.cjs`, `src/preload.cjs`, `src/main.cjs`, `packages/client/services-client/src/host.ts`, and their focused tests
- [x] T024 [US1] Update `packages/client/ui-settings-general/src/remote-device-settings-item.tsx`, `src/general-settings-contribution.ts`, and `src/i18n/{en-US,zh-CN}.ts` to statically compose enablement, exact interface/port selection, QR/manual presentation, safety confirmation, listener errors, and paired-phone revoke/reset using existing shared settings controls/tokens
- [x] T025 [US1] Remove the mobile login gate and render account-free empty/profile plus QR/manual host/port/code pairing states in `apps/mobile/src/state/mobile-app.tsx`, `src/app/index.tsx`, `src/app/pair.tsx`, and `src/i18n/{en-US,zh-CN}.ts`; preserve safe areas, Dynamic Type, translated accessibility labels, and 44-point targets
- [x] T026 [US1] Add a non-UI QR/manual direct-pairing integration harness in `scripts/remote-control-direct-pairing.integration.test.ts` and run the contract, direct-server, mobile pure-logic, Electron lifecycle, i18n parity, and static UI review checkpoint

**Checkpoint**: User Story 1 is usable without account/OIDC/Relay and independently blocks all business data until local desktop approval.

---

## Phase 4: User Story 2 — Control Multiple Sessions Directly (Priority: P2)

**Goal**: A paired phone authenticates to the desktop with a fresh signed challenge and uses the existing encrypted, bounded, idempotent multi-session surface over a direct active-only socket.

**Independent Test**: Against a loopback direct gateway, authenticate two paired devices, read catalog/history, create/send/stop/rename/pin/archive, force a disconnect at uncertain-operation cuts, recover by cursor/snapshot/status, and prove every effect occurs at most once without starting Relay/account/provider services.

### Tests first

- [x] T027 [P] [US2] Add fresh nonce proof, replay, timeout, stale authorization revision, unknown/revoked device, version/identity mismatch, business-before-auth, frame replay, backpressure, and active-socket revoke tests in `packages/server/remote-control-direct-server/tests/authenticated-gateway.test.ts`
- [x] T028 [P] [US2] Replace ticket/Relay transport tests with preferred direct endpoint, pinned challenge, signed authenticate, ordered HPKE receive, active-only lifecycle, reconnect, cursor/snapshot, and operation-status recovery tests in `apps/mobile/tests/remote-transport.test.ts`
- [x] T029 [P] [US2] Update Pi direct/frame tests to remove `accountId`/lease assumptions and prove machine/device/revision/scope/revocation rechecks plus unchanged closed command/projection/ledger behavior in `packages/pi-runtime/pi-runtime-remote-control/tests/direct-frame-processor.test.ts` and `tests/frame-processor.test.ts`

### Implementation

- [x] T030 [US2] Implement fresh challenge issuance/consumption, canonical P-256 verification, negotiated version, authorization refresh, authenticated connection registry, envelope replay cache, revoke/disable closure, and bounded business dispatch in `packages/server/remote-control-direct-server/src/authentication.ts`, `src/gateway.ts`, `src/socket-session.ts`, and `lib/replay-cache.ts`
- [x] T031 [US2] Remove Relay lease/account identity from the Pi remote capability and compose direct authorization in `packages/pi-runtime/pi-runtime-remote-control/src/direct-frame-processor.ts`, `src/frame-processor.ts`, `src/operation-ledger.ts`, `src/operation-service.ts`, `src/runtime-monitor.ts`, and `src/sqlite-ledger.ts`; retain per-request device/revision/scope/revocation checks, command mapping, event ring, snapshot, and SQLite durability
- [x] T032 [US2] Implement the Node `http` plus `ws` exact-address listener adapter, noServer upgrade path, disabled/replace/dispose lifecycle, frame ordering, backpressure, and generic diagnostics in `apps/desktop-electron/src/direct-remote-listener.cjs` and bundle it through `apps/desktop-electron/scripts/prepare-package.cjs`
- [x] T033 [US2] Compose one direct gateway and one Pi bridge/frame generation against the current public Runtime connection in `apps/desktop-electron/src/desktop-remote-control.cjs`; replace outbound Relay connection/ticket/notification code and make Runtime replacement change epoch and force resynchronization
- [x] T034 [US2] Replace account/Relay ticket transport with per-profile direct endpoint dialing, pinned desktop challenge, signed authentication, direct envelope headers, serialized receive projection, and existing recovery operations in `apps/mobile/src/state/remote-transport.ts` and `src/state/remote-client.ts`
- [x] T035 [US2] Rewire machine/session/conversation features to account-free profile transports and remove notification state/actions in `apps/mobile/src/state/mobile-app.tsx`, `src/features/machines.ts`, `src/features/session-catalog.ts`, and `src/features/conversation.ts`
- [x] T036 [US2] Create `scripts/remote-control-direct-closed-loop.integration.test.ts` using the production mobile transport, direct gateway/authentication, Electron listener adapter/frame processor, Pi command adapter, and SQLite ledger; cover catalog/history/create/send/stop/rename/pin/archive/reconnect/snapshot/operation recovery/revoke with no test-only remote seam

**Checkpoint**: User Stories 1 and 2 work through the production direct protocol and retain all requested multi-session behavior without Relay/account services.

---

## Phase 5: User Story 3 — Maintain Reachable Computer Profiles (Priority: P3)

**Goal**: Users can safely maintain several computers and explicitly approved LAN/Tailscale endpoints while identity pinning prevents DHCP/DNS reassignment from reaching a different desktop.

**Independent Test**: Pair two computers, reorder and replace endpoints for one verified identity, fall back between approved LAN/Tailscale endpoints, simulate a different identity at an old address, revoke one phone, and verify unrelated profiles/devices remain intact.

### Tests first

- [x] T037 [P] [US3] Add SQLite migration, multiple profile, endpoint priority/LRU/freshness, atomic edit/remove, private-key separation, and complete profile cleanup tests in `apps/mobile/tests/connection-profile-store.test.ts`
- [x] T038 [P] [US3] Add interface enumeration, selected-address disappearance, all-or-nothing multi-bind, candidate conflict, replacement rollback, disable, Runtime restart, and exact cleanup tests in `apps/desktop-electron/test/direct-remote-listener.test.cjs`
- [x] T039 [P] [US3] Add two-computer/two-phone endpoint fallback, same-identity edit, identity mismatch zero-data/zero-mutation, DHCP reassignment, revoke isolation, and disabled-listener integration cases in `scripts/remote-control-direct-profiles.integration.test.ts`

### Implementation

- [x] T040 [US3] Add connection profile and endpoint tables/migrations plus atomic CRUD/prioritization/removal adapters in `apps/mobile/src/platform/sqlite.ts`, `src/state/connection-profile-store.ts`, and `src/platform/secure-store.ts`, keeping all private keys out of SQLite
- [x] T041 [US3] Implement profile endpoint validation/add/edit/test/reorder/remove and identity-probe behavior in `packages/transport/remote-control-client/src/profiles.ts`, `src/connection.ts`, `apps/mobile/src/state/connection-profile-store.ts`, `src/state/remote-transport.ts`, and `src/features/machines.ts`
- [x] T042 [US3] Add an account-free computer endpoint settings route and profile removal flow in `apps/mobile/src/app/machines/[machineId]/settings.tsx`, link it from the machine/session surface, and add paired `en-US`/`zh-CN` copy/accessibility labels
- [x] T043 [US3] Implement interface enumeration, stable interface IDs, selected-address validation, Tailscale/LAN labels, exact multi-listener preparation, atomic replacement, and disappearance diagnostics in `apps/desktop-electron/src/direct-remote-listener.cjs` and `packages/server/remote-control-direct-server/src/address-policy.ts`
- [x] T044 [US3] Persist listener enable/port/interface revisions before lifecycle changes and expose current/candidate endpoint status through bounded IPC in `apps/desktop-electron/src/desktop-services.cjs`, `src/desktop-remote-control.cjs`, and `src/desktop-renderer-protocol.cjs`
- [x] T045 [US3] Complete desktop/mobile profile UI static review and run the profile-store, listener, direct-profile, identity-mismatch, revoke-isolation, i18n, and owner typecheck checkpoints; record evidence in `specs/014-direct-paired-access/validation.md`

**Checkpoint**: All three user stories work independently and together for multiple computers and phones on explicitly approved LAN/Tailscale endpoints.

---

## Phase 6: Remove Central Topology and Close Cross-Cutting Gates

**Purpose**: Delete superseded account/Relay/push product code, make forbidden dependencies machine-checkable, validate production artifacts, and map every requirement/outcome.

- [x] T046 [P] Remove mobile `expo-auth-session`, `expo-web-browser`, and `expo-notifications` dependencies/plugins plus `src/features/auth.ts`, notification feature/platform/state/tests, OAuth native-intent handling, login/logout/notification UI and translations from `apps/mobile/package.json`, `app.config.ts`, `src/`, and `tests/`; update `pnpm-lock.yaml` only with pnpm
- [x] T047 Remove `apps/remote-control-relay`, old Relay migrations/providers/tests, root `relay:*` scripts, and `@workbench/remote-control-relay-server`; finish the target rename to `@workbench/remote-control-direct-server`, update every workspace dependency/export/test path, and verify no central app/package consumer remains
- [x] T048 [P] Update bilingual READMEs for `@workbench/remote-control-contracts`, `@workbench/remote-control-client`, `@workbench/remote-control-direct-server`, and `@workbench/pi-runtime-remote-control` with direct owner, endpoint grammar, encryption/authentication, lifecycle, budgets, forbidden capabilities, and validation commands
- [x] T049 Update `scripts/check-remote-control-boundaries.mjs`, `scripts/check-remote-control-boundaries.test.mjs`, and `scripts/remote-control-privacy-audit.test.mjs` to enforce zero account/OIDC/Relay/PostgreSQL/push product paths and preserve no-Toolbox/no-Runtime/deep-import/cycle/secret-output rules
- [x] T050 [P] Update `apps/mobile/tests/i18n-parity.test.ts` and `packages/client/ui-settings-general/tests/i18n-parity.test.ts` for direct access, interface/port, QR/manual, identity mismatch, listener failure, revoke/reset, and account/login/notification key removal with exact `en-US`/`zh-CN` interpolation parity
- [x] T051 Run and record exact package/focused non-UI suites for contracts, client, direct server, Pi bridge, mobile pure logic, Electron lifecycle/listener/packaging, direct pairing, direct closed loop, profile identity/revoke, privacy, and boundaries in `specs/014-direct-paired-access/validation.md`
- [x] T052 Run and record `pnpm install --frozen-lockfile`, mobile Expo dependency check/Doctor, single React/RN resolution, production export, and local Android release compile; inspect the production bundle/APK for no OIDC/Relay/provider endpoints or test pairing secrets and do not upload artifacts
- [x] T053 Run and record Electron artifact packaging, verify the packaged direct gateway includes `ws`, address policy, pairing/authentication, HPKE, Pi frame processing, and SQLite ledger with no unresolved workspace import, and list installed-app execution as unexecuted rather than running an Electron/UI smoke
- [x] T054 Run `pnpm lint`, `pnpm format`, `pnpm check:workspace-dependencies`, `pnpm check:package-structure`, `pnpm typecheck`, `pnpm build`, and `git diff --check`; explain only verified unrelated baseline failures and do not modify user-owned changes
- [x] T055 Compare `spec.md`, `plan.md`, `research.md`, `data-model.md`, `contracts/`, `quickstart.md`, tasks, and actual code; map FR-001–FR-026 and SC-001–SC-010 in `specs/014-direct-paired-access/validation.md`, list all unexecuted physical-device LAN/Tailscale/firewall/iOS/UI/release/security gates, and mark complete only with no unexplained deterministic failure

---

## Phase 7: Complete Mobile Conversation Transcripts and Reference UI

**Purpose**: Replace desktop-only tool placeholders with bounded, read-only tool transcripts and align the mobile session/conversation surfaces with the supplied minimal mobile reference without expanding the command allowlist.

- [x] T056 Add strict assistant tool-call/tool-result contract cases, UTF-8 output bounds, unknown-field rejection, and hostile Pi projection fixtures in `packages/contracts/remote-control-contracts/tests/conversation-operations.test.ts` and `packages/pi-runtime/pi-runtime-remote-control/tests/conversation-sanitizer.test.ts`
- [x] T057 Extend the closed conversation item union/codecs with assistant tool-call arguments, raw textual tool results, error state, and explicit truncation in `packages/contracts/remote-control-contracts/src/protocol.ts`, `src/codecs.ts`, and `lib/bounds.ts`; do not add a tool command or approval variant
- [x] T058 Project all user-visible assistant text plus read-only Pi 0.85.1 tool calls/results and bash command/output in `packages/pi-runtime/pi-runtime-remote-control/lib/conversation-sanitizer.ts`, while excluding thinking, binary/image payloads, result details, provider exceptions, approvals, and unknown host events
- [x] T059 Preserve tool calls across live assistant deltas and bound accumulated UTF-8 stream text in `packages/transport/remote-control-client/src/conversation.ts` with focused state coverage
- [x] T060 Restyle the mobile session catalog and conversation routes from the supplied reference using reusable icon/composer/activity components; add expandable selectable raw tool transcript presentation and remove desktop-only viewing copy in `apps/mobile/src/`
- [x] T061 Update paired `en-US`/`zh-CN` copy, package boundary documentation, Spec014 protocol/data/UI decisions, and the privacy audit so tool transcripts are permitted only as authorized conversation data and remain forbidden in logs/diagnostics
- [x] T062 Run contract/Pi/client/mobile tests and typechecks, i18n parity, privacy/boundary/static UI checks, Expo dependency/Doctor/export, Android release compile, and `git diff --check`; record exact evidence and remaining physical-device gates in `specs/014-direct-paired-access/validation.md`

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 — Setup**: starts immediately and preserves the current validated baseline.
- **Phase 2 — Foundation**: depends on Phase 1 and blocks all user stories.
- **Phase 3 — User Story 1**: depends on the direct contract/address/client foundation and is the MVP.
- **Phase 4 — User Story 2**: depends on the paired-device authorization delivered by User Story 1 while retaining an independently testable session-control slice.
- **Phase 5 — User Story 3**: depends on the paired profile/transport from Stories 1–2; profile edits and identity mismatch remain independently testable.
- **Phase 6 — Cleanup/gates**: depends on the direct closed loop and all desired user stories, because account/Relay code is removed only after replacement paths pass.

### User Story Dependencies

```text
Foundation
  └── US1 Direct pairing
        └── US2 Multi-session control
              └── US3 Multiple profiles/endpoints
                    └── Central topology removal and final gates
```

The stories are incremental product slices, but direct authorization is inherently required before session control, and an authorized profile is inherently required before endpoint maintenance.

### Within Each User Story

- Write and observe focused test failures before implementing the corresponding contract/service/adapter.
- Strict contracts and persistence models precede network services.
- Direct server and Pi business owners precede Electron composition.
- Product state/adapters precede UI wiring.
- Integration and static UI review close the story before the next phase.
- Files shared by tasks are changed sequentially even if neighboring tasks are marked `[P]`.

### Parallel Opportunities

- T003 and T004 can proceed independently after T001/T002 context is known.
- T005–T008 cover separate contract/server/client/script owners.
- T015–T017 cover server, mobile, and Electron test owners.
- T027–T029 cover gateway, mobile, and Pi tests.
- T037–T039 cover mobile storage, Electron listeners, and cross-app integration.
- T046, T048, and T050 can proceed independently only after every retained direct replacement passes.

## Parallel Example: User Story 1

```text
Task T015: Direct pairing-service tests in the direct-server package
Task T016: Mobile QR/manual pairing tests in the Expo app
Task T017: Electron encrypted storage/copy-boundary tests
```

## Parallel Example: User Story 2

```text
Task T027: Direct challenge/gateway authentication tests
Task T028: Mobile direct transport and recovery tests
Task T029: Pi bridge account-removal authorization tests
```

## Implementation Strategy

### MVP First

1. Complete baseline and the direct foundation.
2. Complete User Story 1 through T026.
3. Validate pairing with no account, provider, or Relay.
4. Do not remove the old central topology until the direct pairing and session closed loops are both green.

### Incremental Delivery

1. Foundation establishes the new trust/wire model.
2. US1 provides account-free QR/manual pairing and local revocation.
3. US2 reuses validated multi-session behavior over direct sockets.
4. US3 adds safe multi-computer/endpoint maintenance.
5. Cleanup removes the superseded central architecture and runs production/full-repository gates.

### Rollback Discipline

- Listener replacement is all-or-nothing and retains the previous healthy generation on candidate failure.
- Storage changes persist before visible authorization/configuration success.
- Mobile migrations preserve existing session projections only when they can be associated with a verified direct profile; account/Relay credentials are never reinterpreted as direct authorization.
- Spec 013 artifacts remain historical evidence; deleting its documentation is out of scope.

## Notes

- Use pnpm exclusively; do not create npm/yarn lockfiles.
- Preserve unrelated worktree changes.
- No UI/DOM/Hook render tests, Browser/Electron UI smoke, deployment, signing, store submission, or artifact upload.
- Tailscale is address reachability only; do not add a Tailscale SDK/API/auth key.
- Never bind or proxy the existing Runtime listener to LAN/Tailscale.
- Check a task only after its implementation and focused validation evidence are complete.

## Workbench 项目约定

遵循 `.specify/memory/constitution.md`：库包根 `packages/<领域>/<能力>`，src 为真实能力实现/契约/装配，lib 为内部辅助源码，两处均最多一级子目录；src 不得全为转导出。能力与辅助源码均保留 TS/TSX，不改写为 JS，tests/ 为库包测试目录；使用 pnpm。能力迁移任务必须包含前置任务、来源/目标、消费者、验证与完成条件；只在验证后勾选。
