# Tasks: 包职责收敛与可复用能力边界

Input: spec.md, plan.md, research.md, data-model.md, contracts/public-boundaries.md, ownership-map.md, quickstart.md. User authorized implementation on 2026-09-13. Only mark complete with validation evidence in validation.md. No UI/DOM/Hook tests or smoke execution.

## Phase 1: Setup

- [x] T001 Capture baseline and preserve user edits in specs/008-package-reuse-boundaries/source-inventory.json; source hashes verified before migration.
- [x] T002 Resolve research and freeze owners/contracts in specs/008-package-reuse-boundaries/plan.md and contracts/public-boundaries.md; W1–W6 sources/consumers recorded in ownership-map.md.
- [x] T003 Verify completed checklists/requirements.md, ignore rules and installed Pi SDK public declarations; record exclusions in quickstart.md.

## Phase 2: Foundational

- [x] T004 Select exact non-UI source tests into specs/008-package-reuse-boundaries/non-ui-tests.json; exclude DOM/download/render fixtures and retain source ownership mapping; depends T001–T003.
- [x] T005 Establish neutral catalog contracts in packages/agent-runtime/agent-runtime-contracts/src/workspace-catalog.ts and explicit exports; depends T002, unchanged DTO shape with narrow create/attach/list/remove operations.

## Phase 3: US1 narrow capability boundaries

Goal: concrete implementations can be replaced through minimal contracts. Independent validation: minimal fakes, forbidden-import checks and owner/consumer types.

- [x] T006 [US1] Move BrowserHost to packages/contracts/browser-contracts/src/host.ts, update Pi browser/host port consumers and delete old type export; depends T002.
- [x] T007 [US1] Add WorkspaceFileReader using existing DTOs in packages/agent-runtime/agent-runtime-contracts/src/runtime-capabilities.ts; replace concrete WorkspaceFileService Pick in pi-server-ports/src/host-bindings.ts; depends T002.
- [x] T008 [US1] Update packages/pi/pi-session-server/src/session-runtime-dependencies.ts, external-session-import-service.ts and pi-automation-service.ts to explicit catalog operation ports; depends T005.
- [x] T009 [US1] Validate narrow contracts and implementation conformance in packages/pi/pi-server-ports/tests and owner/consumer typechecks; remove manifest implementation edges; depends T006–T008.

## Phase 4: US2 file presentation reuse

Goal: attachment/tree icons and image/file saves share independent capabilities. Validation: pure icon tests, source/resource review, type/closure checks; download DOM tests only migrate/static review.

- [x] T010 [P] [US2] Move icons/material helper and download to packages/client/ui-file-presentation/src and lib; add explicit asset provider, exports, package config and bilingual README; depends T002.
- [x] T011 [US2] Migrate icon/save consumers in packages/client/ui-attachment, ui-message-blocks, ui-layout and packages/workspace/workspace-files/review/git-branch; remove old source and tree/download forwards; depends T010.
- [x] T012 [US2] Move pure icon/download test ownership to packages/client/ui-file-presentation/tests, update existing provider fixtures statically, run pure icon tests and check resources/semantic styling and affected types; depends T011.

## Phase 5: US3 headless workspaces

Goal: panel core and project catalog work without UI or Pi. Independent validation: store/controller/feedback/persistence/catalog node tests plus neutral-event/Pi adapter compatibility.

- [x] T013 [P] [US3] Separate headless draft and installation lifecycle in packages/workspace/workspace-runtime/src, preserve one state/controller/feedback owner; depends T002.
- [x] T014 [US3] Move React/DOM/presentation/layout/i18n/CSS to packages/client/ui-workspace/src and lib with explicit exports and bilingual README; depends T013.
- [x] T015 [US3] Migrate workspace React/presentation consumers, Shell resource entries and test import ownership; remove workspace-runtime old UI entries; depends T014, coordinate ui-layout write with T011.
- [x] T016 [US3] Run exact core store/controller/draft/feedback/persistence tests and headless closure/types, statically inspect UI lifecycle/styles/Portal; depends T015.
- [x] T017 [US3] Update workspace-runtime/ui-workspace manifests, consumers and root export/resource checks; depends T016, root owns existing manifests.
- [x] T018 [US3] Move pi-resources-server WorkspaceStore to packages/server/workspace-server/src/catalog.ts and consumed lib/catalog-state.ts with neutral event/persistence contracts; depends T005.
- [x] T019 [US3] Adapt neutral events in packages/pi/pi-server/src/resource-composition/workspace-store.ts and preserve registry replacement/lazy resolution/cleanup; update Pi DTO and workspace protocol consumers; depends T018.
- [x] T020 [US3] Move catalog tests from Pi server to packages/server/workspace-server/tests/catalog.test.ts, retain Pi adapter/integration tests and add event-once/disposal verification; depends T019.
- [x] T021 [US3] Verify legacy migration, locking, sorting/archive, event payload/order and errors with exact non-UI tests; delete pi-resources-server old export and update bilingual docs; depends T020.

## Phase 6: US4 session responsibility separation

Goal: catalog, live state, history, attachments and interactions have distinct owners without whole-manager/registry dependencies. Independent validation: existing session characterization/generation/queue/attachment tests and focused state-owner behavior tests.

- [x] T022 [US4] Freeze package-internal session dependencies in packages/pi/pi-client/src/runtime/session-dependencies.ts; manager binds exact transport/lifecycle/feedback/fork operations; depends T008.
- [x] T023 [US4] Extract focused history/attachment/interaction and directory ownership from packages/pi/pi-client/src/runtime/session.ts and manager.ts into same-package modules; reuse pi-conversation/pi-transport-client; depends T022.
- [x] T024 [US4] Preserve server singleton/HMR state with focused live/catalog/scratch/fork state ownership in packages/pi/pi-session-server/src; depends T008.
- [x] T025 [US4] Separate HostedPiSession lifecycle and narrow history/composer coordination from packages/pi/pi-session-server/src/session-registry.ts; keep one SDK instance, event sequence and mutation owner; depends T024.
- [x] T026 [US4] Update exact client tests for minimal dependencies, late history/attachment results, cancellation, feedback and queue behavior in packages/pi/pi-client/tests; depends T023.
- [x] T027 [US4] Add/adjust focused server behavior tests for start coalescing, catalog refresh, scratch lifecycle and history/queue serialization in packages/pi/pi-session-server/tests; depends T025.
- [x] T028 [US4] Run exact client/server/conversation/transport test set and types; review public registry API and singleton invariants; depends T026–T027.
- [x] T029 [US4] Update packages/pi/pi-client and pi-session-server bilingual README and consumers, remove whole-manager/whole-state seams; depends T028.

## Phase 7: US5 enforce ownership

Goal: reuse decisions remain reviewable and regressions are detectable. Validation: final source mapping and static negative architecture tests.

- [x] T030 [US5] Extend scripts/refactor-architecture-boundaries.test.mjs for forbidden ports, neutral catalog, headless workspace, file entry closures and old-entry absence; update existing public-workspace/source-boundary checks; depends T009/T012/T017/T021/T029.
- [x] T031 [US5] Synchronize all affected package.json files, pnpm-lock.yaml, root scripts and resource/export consumers; run dependency/structure checks; depends T030.
- [x] T032 [US5] Record final source migration inventory and responsibility comparison in specs/008-package-reuse-boundaries/validation.md and ownership-map.md; no empty helpers/duplicate state/temporary forwards; depends T031.

## Final Phase: integration

- [x] T033 Run exact non-ui-tests.json set, architecture/checker tests, pnpm typecheck and pnpm lint; record actual results in specs/008-package-reuse-boundaries/validation.md; depends T031.
- [x] T034 Run pnpm build and frozen offline install, inspect resource/core closure checks, record limitations; depends T033.
- [x] T035 Reconcile specs/008-package-reuse-boundaries/spec.md status and all tasks against real code/results, validate docs and git diff --check, preserve unrelated edits; depends T032–T034.

## Dependencies and parallel examples

T001–T003 → W1/W2/W3 planning gate. W1 and W4 share root contracts; W2 (Luna) and W3 (Sol) can proceed independently after frozen ownership, serializing overlapping source files. W5/W6 (Sol) depend on W1 narrow catalog operation contract, not the final physical catalog move. Root handles shared manifests after workers release sources. US1 is the first independently verifiable slice; user authorized all stories, so continue through integration rather than stopping after it.

Task counts: setup 3, foundational 2, US1 4, US2 3, US3 9, US4 8, US5 3, integration 3 = 35. Parallel work never overrides exclusive file ownership. Pure test additions target behavior/invariants, not a mirror of implementation.
