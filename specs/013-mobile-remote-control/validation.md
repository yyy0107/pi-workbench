# Validation: Workbench Mobile Remote Control

> **Superseded topology notice (2026-09-13)**: These results validate the former account/OIDC/central-Relay topology and remain useful as a migration baseline. [Spec 014](../014-direct-paired-access/spec.md) is the current product requirement and must replace the central topology before release.

**Feature**: `013-mobile-remote-control`<br>
**Started**: 2026-09-13<br>
**Implementation status**: Implementation and deterministic non-UI validation complete; physical-device, deployed-service, iOS/EAS, distribution-signing, and store-delivery gates remain explicitly unexecuted

This file records command-level evidence for `tasks.md`. A task is checked only after its required implementation and focused validation succeed. UI/DOM/Hook render tests and UI interaction smoke tests are intentionally not added or run under the repository's current instruction; real-device behavior remains an explicit release gate.

## T001 — Baseline

**Status**: PASS

### Environment

- Actual Git branch: `codex/package-refactor`.
- Logical Speckit feature: `013-mobile-remote-control`.
- Node: `v24.16.0`.
- pnpm: `11.22.0`.
- Existing library packages before this feature: 96.
- Existing apps before this feature: 4.

### Existing public integration entries

- `@workbench/pi-rpc-client`: `.`, `./api`, `./connections`.
- `@workbench/runtime-transport-client`: `.`, `./runtime-fetch`, `./runtime-websocket`.
- `@workbench/pi-conversation-adapter`: public projection/rpc/accumulator entries exist, but the mobile app must not depend on this package because its current graph reaches the browser/React client.
- The desktop bridge will consume only public exports. It will not import `apps/runtime-node/src/*`, a private Pi registry, or `streams/stream-hub`.

### Baseline checks

```text
pnpm check:workspace-dependencies
PASS — check-workspace-dependencies.mjs and check-runtime-host-ownership.mjs exited 0.

pnpm check:package-structure
PASS — Package structure: 96 libraries, 546 test files, 0 tracked migration violations.
```

### Existing worktree preservation

The worktree was already dirty before implementation. Existing edits include skills, conversation/message presentation, Pi RPC/client/server files, toolbox/product runtime files, `pnpm-lock.yaml`, and untracked file-change presentation sources/tests. In particular, `packages/pi-runtime/pi-rpc-contracts/src/rpc.ts` is already modified and overlaps future T055. These changes are treated as user-owned: no reset, checkout, deletion, or broad formatter is permitted, and any later overlap must be inspected and patched incrementally.

### Ignore-file verification

The repository is a Git repository and already had `.gitignore`. No Dockerfile, ESLint/Prettier configuration, Terraform, or Helm chart was detected, and the root package is private, so no additional tool-specific ignore file is required. `.gitignore` was extended only with precise Expo/CNG, mobile/Relay output, log/temp, and editor patterns; no broad `**/build/` rule was added because it would hide the tracked `packages/build` source domain.

### Not executed

- No UI/DOM/Hook test.
- No UI interaction smoke.
- No product build or full test suite; these belong to later tasks after new packages exist.
- No publishing, deployment, EAS upload, or external credential operation.

## T002–T008 — Setup packages and applications

**Status**: PASS

### Created ownership boundaries

- At setup time, `@workbench/remote-control-contracts` at `packages/contracts/remote-control-contracts` had explicit root/protocol/codecs/crypto exports and only `@workbench/core-contracts` as a production dependency. T016 later added the reviewed, exact `@hpke/core@1.9.0` runtime dependency.
- `@workbench/remote-control-client` at `packages/transport/remote-control-client` with explicit client/ports exports and only the remote contract as a production dependency.
- `@workbench/remote-control-relay-server` at `packages/server/remote-control-relay-server`, with no Pi/Electron/UI dependency.
- `@workbench/pi-runtime-remote-control` at `packages/pi-runtime/pi-runtime-remote-control`, limited to the remote contract and public Pi RPC/Runtime transport client packages.
- `@workbench/remote-control-relay` at `apps/remote-control-relay`, currently an injected no-op lifecycle/configuration scaffold and not a network listener.
- `@workbench/mobile` at `apps/mobile`, using Expo `~57.0.22`, Expo Router `~57.0.21`, React `19.2.3`, React Native `0.86.3`, TypeScript `~6.0.3`, custom scheme `workbench-remote`, automatic appearance, Development Build scripts, and CNG-owned native projects.

The mobile scaffold intentionally renders no product copy or desktop-derived visual control yet. The UI styling guidance was applied by avoiding DOM/Shell imports, copied CSS tokens, hard-coded colors, and premature mobile theme infrastructure; real product controls remain in their user-story tasks.

### Root integration and boundaries

- Added independent `mobile:dev`, `mobile:export`, and `relay:dev` scripts without changing the existing desktop `build` pipeline.
- Added `check:remote-control-boundaries` plus three tests covering forbidden manifests/imports/catch-all wire contracts and the intended dependency direction.
- Confirmed existing workspace globs already cover all six directories.
- Added precise `.gitignore` patterns for Expo/CNG/mobile/Relay outputs and universal temporary files.
- pnpm synchronized workspace links and lockfile importers after the new packages were introduced. The pre-existing lockfile changes were preserved rather than replaced.

### Validation

```text
node --test scripts/check-remote-control-boundaries.test.mjs
PASS — 3 tests, 0 failures.

pnpm check:remote-control-boundaries
PASS.

Manifest/package-name validation
PASS — all six names equal @workbench/<leaf>; all JSON parsed.

Relay lifecycle import/start/stop scaffold
PASS under Node v24 type stripping.

git diff --check (all T002–T008 paths and pnpm-lock.yaml)
PASS.
```

At setup-validation time no generated `apps/mobile/ios` or `apps/mobile/android` directory existed. T016 later generated the ignored Android CNG project solely for the local native cryptography build gate; it remains untracked. No UI test, deployment, publishing, EAS upload, or external credential action was performed.

## T009–T013 — Closed protocol, limits, and codecs

**Status**: PASS

The contract package now contains a closed v1 protocol for socket authentication, sealed envelopes, action scopes, seven allowed commands, operation results, stable errors, machine/session/conversation projection, cursor/events/snapshot, and privacy-safe push hints. `lib/bounds.ts` and `lib/canonical-json.ts` are real consumed helpers for canonical encoding, ASCII IDs, RFC 3339 timestamps, decimal uint64 cursor offsets, UTF-8 aggregate limits, object/array/depth limits, and deterministic digest input.

T009 was run before implementation and failed with `ERR_MODULE_NOT_FOUND` for the absent codec, establishing the expected red state. After T010–T013:

```text
pnpm --filter @workbench/remote-control-contracts typecheck
PASS.

pnpm --filter @workbench/remote-control-contracts test
PASS — 5 tests, 0 failures.

pnpm check:remote-control-boundaries
PASS.

git diff --check -- packages/contracts/remote-control-contracts
PASS.
```

Tests cover strict extra-field/discriminant rejection, text-only operations, forbidden catch-all and attachment shapes, incompatible versions, ID/time/cursor validation, max uint64, Chinese/emoji byte accounting, JSON depth, credential-free authentication acknowledgement shapes, sealed envelope fields, push privacy, and bounded structured errors. The package contains no production `method: string` plus `payload: unknown` escape hatch.

## T014–T017 — Authenticated HPKE interoperability hard gate

**Status**: **PASS — T018 and later phases are unlocked**

The implementation, deterministic cryptographic tests, production bundling, Android native compilation, and actual Android React Native/JSI runtime interoperability pass. After the initial environment-only block was recorded, the user explicitly authorized installation of the Android Emulator and continued execution. A dedicated test entry ran inside an Android 16/API 36 Release app using QuickCrypto; the normal Expo Router product entry was not modified or coupled to the test fixture.

### Test-first evidence

- `packages/contracts/remote-control-contracts/tests/hpke-vectors.test.ts` was added before the implementation. Its first run failed because `@hpke/core` and the crypto exports did not exist.
- `apps/mobile/tests/hpke-interop.test.ts` was added before the platform adapter. Its first run failed because `src/platform/crypto.ts` did not exist.
- The final contract suite covers the RFC 9180 authenticated-mode known-answer vector; correct round trip; wrong recipient and sender keys; all caller AAD and relay-visible header fields; `enc`, ciphertext, and `keyId` tampering; expiry; and current/retired-key rotation behavior.
- The mobile harness covers both directions and fail-closed behavior when neither standards WebCrypto nor the native installer is available. It deliberately reports that Expo Go is unsupported because the native module requires a Development Build.

```text
pnpm --filter @workbench/remote-control-contracts typecheck
PASS.

pnpm --filter @workbench/remote-control-contracts test
PASS — 9 tests, 0 failures, including the RFC 9180 Auth known-answer vector.

pnpm --filter @workbench/mobile typecheck
PASS.

pnpm --filter @workbench/mobile test
PASS — 4 tests, 0 failures.
```

### Selected construction and dependency record

- HPKE: exact `@hpke/core@1.9.0`.
- Suite: RFC 9180 Auth mode with DHKEM(P-256, HKDF-SHA256), HKDF-SHA256, and AES-256-GCM.
- Stable `info`: `workbench/remote-control/v1/hpke-auth`.
- Mobile native crypto: exact `react-native-quick-crypto@1.1.6`, `react-native-nitro-modules@0.37.1`, and `react-native-quick-base64@3.0.1`; Expo config plugin support comes from `expo-build-properties@~57.0.17`.
- The implementation uses the standards WebCrypto surface expected by `@hpke/core`. The mobile adapter lazily installs QuickCrypto only if the required native/standards primitives are absent; it does not install a JavaScript cryptography polyfill.
- Sealed-envelope AAD length-prefixes and authenticates every routing header plus `keyId`. Public/private material uses uncompressed P-256 public keys and 32-byte private scalars. Base64url inputs must be canonical. Decrypt validates expiry and the recipient key's decrypt-only grace window, and all cryptographic failures map to bounded generic codes without forwarding provider exception text.

`@hpke/core` upstream documents browser and Node WebCrypto support, Auth mode, the selected P-256/HKDF-SHA256/AES-256-GCM components, and successful RFC/Wycheproof vectors. It also explicitly states that the library has **not been formally audited**, so a future independent cryptographic review remains a release risk. GHSA-73g8-5h73-26h4 affects `@hpke/core <=1.7.4` and is patched in `^1.7.5`; the exact selected `1.9.0` is outside that affected range.

### Supply-chain evidence

Every `pnpm` dependency operation completed with the repository's lockfile supply-chain policy check. The production audit is recorded without hiding unrelated failures:

```text
pnpm audit --prod --json
FAIL (repository-wide) — 16 advisories: 4 moderate, 10 high, 2 critical across 1,270 production/optional dependencies.
Advisory module names: @xmldom/xmldom, decode-uri-component, image-size, js-yaml, next, sharp, uuid.
```

None of the selected cryptographic module names (`@hpke/core`, `@hpke/common`, `react-native-quick-crypto`, `react-native-nitro-modules`, or `react-native-quick-base64`) appears as an advisory module in that report. This is not represented as a clean repository audit: existing Next.js critical findings and Expo/tooling transitive findings remain outside this hard-gate implementation and require separate remediation/triage.

### Production bundle and native-build evidence

```text
pnpm mobile:export
PASS — Android and iOS production Hermes bundles emitted.

Bundle scan
PASS — both platform bundles contain the HPKE info label, the native-WebCrypto fail-closed message, and the react-native-quick-crypto module marker.

pnpm --dir apps/mobile exec expo prebuild --platform android --no-install
PASS — ignored Android CNG project generated; QuickCrypto config plugin applied.

ANDROID_HOME=/home/wy/Android/Sdk ANDROID_SDK_ROOT=/home/wy/Android/Sdk \
  apps/mobile/android/gradlew :app:assembleRelease --no-daemon
PASS — 633 actionable tasks; QuickCrypto/Nitro native code compiled and linked for arm64-v8a, armeabi-v7a, x86, and x86_64.
```

The restored normal-product unsigned release artifact is `apps/mobile/android/app/build/outputs/apk/release/app-release.apk`, 141,285,096 bytes, SHA-256 `c4d938e92566c66e0c996a77c5639f77225227388c539c557dc100281424f4b7`. Archive inspection finds `libQuickCrypto.so`, `libNitroModules.so`, and `libreactnative.so` for all four ABIs. It is an ignored local verification artifact and was not published or uploaded.

The native build emitted upstream OpenSSL 3 deprecation warnings but no compilation or link errors. `expo-system-ui` is not installed, so CNG warned that native `userInterfaceStyle` configuration would not be synchronized; this is unrelated to the cryptography build and remains future mobile-shell work.

### Actual Android React Native runtime evidence and gate decision

```text
Android Emulator 37.1.11 + system-images;android-36;default;x86_64
INSTALLED with explicit user authorization.

AVD WorkbenchRemoteApi36
PASS — KVM-backed headless Android 16 / API 36 boot completed; adb device emulator-5554 ready.

ENTRY_FILE=tests/native-hpke-runtime-entry.ts \
  apps/mobile/android/gradlew :app:assembleRelease --no-daemon \
  -PreactNativeArchitectures=x86_64
PASS — dedicated native test APK built; 585 actionable tasks.

adb install + MainActivity cold launch
PASS — Release application started in the emulator.

ReactNativeJS result
PASS — runtimeSource=react-native-quick-crypto;
       Node→native plaintext=node-to-native-react-native;
       tampered ciphertext rejected;
       native→Node sealed envelope emitted without private material.

adb logcat result | pnpm exec tsx apps/mobile/tests/verify-native-hpke-result.ts
PASS — host Node authenticated and decrypted the native-generated envelope as
       native-react-native-to-node.

Normal product rebuild without ENTRY_FILE
PASS — 633 actionable tasks; all four ABIs restored.

Normal APK bundle scan
PASS — native harness marker, fixed envelope ID, and test private scalar are absent.

iOS native execution
NOT EXECUTED — current host is Linux; retained as an explicit later release gate.
```

The first native attempt returned `authentication_failed`. The same fixed envelope also failed under Node, proving that the failure was in the test fixture: the RFC `deriveKeyPair` input key material had been copied as though it were the serialized private scalar. The fixture was corrected to use `serializePrivateKey` output, verified under Node, and then rebuilt and passed in the native runtime. This was not treated as a product-crypto or QuickCrypto success until the corrected fixture passed in both environments.

**T017 decision: PASS.** The authenticated HPKE candidate now has RFC known-answer evidence, bidirectional Node test-harness evidence, an actual React Native/QuickCrypto Node→native result, native tamper rejection, and an independently verified native→Node result. T018 and later phases are unlocked. The absence of iOS execution and the upstream library's lack of a formal audit remain explicit release risks; neither causes a TLS-only fallback.

### Repository checks after the gate work

The three future capability packages initially had only manifests/README files, which made the current repository structure check fail even though their business phases remain locked. They now contain minimal real, forward-compatible contracts/helpers: client version compatibility, Relay idempotent lifecycle consumed by the Relay app, and the desktop bridge's closed seven-command surface. No post-gate networking, authentication, storage, or user-story behavior was implemented.

```text
pnpm --filter @workbench/remote-control-client typecheck
pnpm --filter @workbench/remote-control-relay-server typecheck
pnpm --filter @workbench/pi-runtime-remote-control typecheck
pnpm --filter @workbench/remote-control-relay typecheck
PASS.

pnpm check:remote-control-boundaries
PASS.

pnpm check:workspace-dependencies
PASS.

pnpm check:package-structure
PASS — 100 libraries, 551 test files, 0 tracked migration violations.

git diff --check
PASS.
```

No UI/DOM/Hook render test, UI interaction smoke, EAS build, iOS build, deployment, publishing, source upload, or artifact upload was performed.

## T018–T026 — Transport, Relay persistence, and mobile foundation

**Status**: PASS

The pure remote client now owns credential-free socket authentication, protocol negotiation, full-jitter reconnect, sustained-backpressure handling, pairing state, and stale/revoked transitions. The Relay package owns strict identity/authorization, socket tickets, active desktop leases, bounded HTTP/WSS entry points, PostgreSQL metadata persistence, encrypted provider secrets, health/readiness, and lifecycle composition. The Relay migration contains pairing, device authorization, ticket, presence, notification, and audit metadata only; it does not contain session titles, prompts, messages, answers, tool payloads, or ciphertext queues.

The mobile foundation uses the shared i18n runtime with one React 19.2 instance, app-local `en-US`/`zh-CN` dictionaries, native metadata localization, SecureStore for credentials and key material, and SQLite for bounded projections. Access tokens remain memory-only. Native key cleanup is indexed independently of SQLite so a surviving iOS Keychain is cleared when the installation sentinel/database disappears after reinstall.

Focused evidence at the US1 checkpoint:

```text
pnpm --filter @workbench/remote-control-contracts typecheck && test
PASS — 13 tests.

pnpm --filter @workbench/remote-control-client typecheck && test
PASS — 9 tests.

pnpm --filter @workbench/remote-control-relay-server typecheck && test
PASS — 16 tests.

pnpm --filter @workbench/remote-control-relay typecheck && test
PASS — 20 tests.

pnpm --filter @workbench/mobile typecheck && test
PASS — 18 tests.
```

## T027–T047 — US1 pairing, machine/session catalog, and revoke

**Status**: PASS for the non-UI MVP checkpoint

### Implemented path

- Desktop creates an expiring invitation from its Electron-main bridge. The renderer receives only the QR/manual payload and pairing/device administration projection through a narrow, strict local IPC contract.
- The phone uses system-browser Authorization Code + PKCE, accepts only a strict QR or base64url manual payload from an exact HTTPS Relay-origin allowlist, generates independent signing/HPKE keys, and claims the invitation with a transcript-bound proof.
- Relay binds the claim to the authenticated account/device and stores only the pairing/device authorization metadata. Desktop and phone derive the same six-digit safety code independently; a confirmation installs the phone's public encryption key and closed action scopes in the desktop registry.
- Desktop session projection uses only public Pi RPC/workspace APIs, excludes archived sessions, and exposes at most 100 items/192 KiB. Workspace paths, `cwd`, credentials, tools, attachments, and arbitrary source fields are discarded. The mobile cache marks an offline page stale and disables mutation.
- Device revoke advances its revision, invalidates only that device's socket, and makes subsequent desktop-bridge reads fail even if the caller retains its earlier authorization and lease values.

The new `pair-list-revoke.integration.test.ts` imports the actual Relay pairing/device services, desktop pairing/authorization/bridge modules, and mobile session-catalog feature through their application seams. Its first execution found a missing `pairingId` in Relay's claimed-invitation read projection; the desktop poll could not correlate the claim and failed with `pairing_not_found`. The service projection and focused regression assertion were corrected before this checkpoint was accepted.

### Integrated success-criterion proxies

- **SC-001 proxy**: create invitation → reject a foreign-account claim → valid phone claim → compare safety code → desktop confirmation → first session list is asserted below 120 seconds in the deterministic harness. This proves the complete functional path and budget guard, not the required 90% first-time-user study.
- **SC-002 proxy**: an authoritative foreground session-catalog read is asserted below two seconds and produces a usable, path-free projection. This is an in-process integration budget guard, not the required production-connectivity p95 measurement.
- **SC-008 proxy**: revoke is asserted below one minute, immediately invalidates the target device, and blocks the next read. Separate bridge tests also revoke during an in-flight Runtime read and verify the second authorization check rejects it. Production propagation measurement with a deployed Relay remains a release gate.

### Failure-path evidence

- A validly signed claim using a different authenticated account is rejected without consuming the invitation.
- A desktop confirmation with the wrong displayed safety code is rejected locally and leaves the invitation available for the correct comparison.
- Offline session loading returns the last validated cache as `stale`, sets `canMutate: false`, and reports `machine_offline`; it does not invoke or queue a remote mutation.
- Reusing the pre-revocation entity revision is rejected with `entity_revision_conflict`.
- Catalog fixtures containing `cwd` and workspace `rootPath` yield neither value in the mobile projection.
- Explicit desktop OIDC principals require the desktop marker and a bounded machine ID; unknown toolbox scope is removed from the closed remote scope set.
- Pairing GET/DELETE routes preserve the authenticated principal, reject request bodies/path confusion, and expose no machine credential or private key.

### Validation commands

```text
pnpm --filter @workbench/remote-control-relay typecheck && test
PASS — 20 tests, including pair → list → offline stale → revoke integration.

pnpm --filter @workbench/pi-runtime-remote-control typecheck && test
PASS — 7 tests.

pnpm --filter @workbench/services-client typecheck && test
PASS — 11 tests.

node --test apps/desktop-electron/test/remote-control-lifecycle.test.cjs
PASS — 4 tests.

pnpm --filter @workbench/ui-settings-general typecheck
PASS.

pnpm --dir apps/mobile exec expo config --type public --json
PASS — native metadata contains both `en` and `zh-CN` locale sources.

pnpm check:remote-control-boundaries
PASS.

git diff --check
PASS.
```

No UI/DOM/Hook render test or UI interaction smoke was added or run. A real camera scan of a QR code, manual entry on physical iOS/Android devices, system-browser sign-in against the production IdP, two-device safety-code comparison, deployed PostgreSQL/Relay/WSS traffic, desktop account/machine credential provisioning, and production latency/revocation measurements were **not executed**. The Android native HPKE runtime evidence from T017 remains valid, but it is not a substitute for those US1 product checks. Desktop remote control currently fails closed when its external account/installation service has not provisioned a machine credential; that provisioning owner and access-token refresh/rotation path must be completed before release.

## T048–T066 — US2 bounded conversation control

**Status**: PASS for the pre-paired, deterministic non-UI checkpoint

### Closed conversation and command surface

- `RemoteConversationPageV1` accepts at most 50 items and 192 KiB per page. Assistant deltas accept at most 16 KiB. Tool lifecycle is projected only as a generic activity summary capped by the closed contract; paths, attachment data, tool names/arguments/results, reasoning, raw errors, and unknown host payloads are omitted.
- The local command adapter maps history, exactly one text block for `session.send`, `session.stop`, and an already-pending ordinary question through public Pi client APIs. It does not pass caller objects through to Pi. Attachment/file/image content, Composer commands, tool approvals, terminal, browser, Toolbox, arbitrary RPC, unarchive, and delete have no fallback branch.
- The mobile SQLite schema v2 accepts only strictly parsed conversation pages and operation requests/results. It retains at most 20 conversation snapshots by LRU, drafts up to 64 KiB UTF-8, and bounded unresolved operations. Hostile tool/approval/credential-bearing extension fields are rejected before a write.
- The phone conversation state persists drafts and unresolved operations. Disconnect changes sending/accepted operations to `outcome-unknown`; becoming ready does not transmit them. Only the explicit retry action reuses the original operation ID. A terminal result with an `appliedCursor` remains pending until the authoritative projection includes that cursor, so optimistic state cannot replace desktop authority.

### Authoritative send identity and crash behavior

`SessionPromptPayload` now has an optional, backward-compatible `clientMutation: { operationId, messageId }`. Existing callers that omit it retain their prior behavior. The identity is passed through the neutral Agent execution port and recorded as `workbench.client-mutation.v1` in the authoritative Pi session journal immediately before queue/prompt admission. An exact match after the bridge/session service is reconstructed returns the same message identity without prompting again; reuse of either identity with a different pair is rejected. The marker contains no prompt text.

The desktop operation SQLite ledger stores the command type, canonical SHA-256 digest, closed domain identity, state/result, and timestamps—not the original command or prompt. Its behavior tests cover all four required crash cuts:

1. before durable intent;
2. after durable intent and before domain effect;
3. after domain effect and before terminal result persistence;
4. after terminal result persistence and process reopen.

The same operation ID plus the same canonical digest replays the retained state/result; a different digest conflicts. Incomplete entries are never pruned for capacity. Completed entries retain the last seven days and no fewer than the most recent 10,000 according to the tested pruning policy. The SQLite file is mode `0600`, uses `secure_delete`, and the long-lived database bytes do not contain the submitted prompt fixture.

### Integrated E2EE flow and success-criterion proxies

`conversation-control.integration.test.ts` uses the real authenticated HPKE implementation, Relay sealed router, desktop command adapter and operation service, mode-0600 SQLite ledger, mobile conversation store, and mobile remote-session state. It executes:

```text
bounded history read
  -> mobile text send
  -> accepted + terminal results
  -> assistant stream delta
  -> exact send replay
  -> stop
  -> ordinary-question answer
  -> forbidden tool.approve attempt
```

Every phone→desktop and desktop→phone payload crosses the actual Relay router only as an authenticated sealed envelope. The test scans all Relay-visible envelopes and audit events and finds none of the prompt, history answer, stream text, or forbidden approval plaintext. The Relay retains zero pending payloads after delivery, and the desktop ledger contains no prompt plaintext. The invalid `tool.approve` command reaches the desktop only as ciphertext, then fails the closed inner parser without invoking prompt, stop, or question-answer effects.

- **SC-003 deterministic proxy**: the integration test asserts both text-send acceptance/terminal processing and stop processing complete in under two seconds. The current local run completed the full read/send/stream/replay/stop/question/security scenario in about 85 ms. This is a functional budget guard, not the required production-network p95 measurement across users/devices.
- **SC-007 deterministic evidence**: strict contract tests reject Toolbox, file, terminal, browser, tool approval, and arbitrary RPC variants; the command adapter has no generic method/payload fallback; the integration test sends an encrypted approval-shaped payload and observes zero local effect; `check:remote-control-boundaries` rejects mobile→Pi/Desktop/Toolbox and Relay→Pi imports. No prohibited route was found in this checkpoint.
- **SC-004 partial evidence**: exact send replay in the integrated encrypted path triggers one prompt effect, and the journal reconstruction test triggers one prompt across two bridge-service generations. Full five-second convergence after Runtime restart/network switching belongs to T093–T108 and is not claimed here.
- **SC-009 evidence for this phase**: all new conversation/run/composer/question strings have matching `en-US` and `zh-CN` keys, and the parity test resolves every key in both locales.

### UTF-8, large-line, and privacy budgets

- A 70,000-character Chinese single-line assistant fixture is omitted rather than split or leaked; the resulting page remains at or below 192 KiB UTF-8 and 50 items.
- A 15,000-byte Chinese assistant delta is accepted; an 18,000-byte delta is rejected against the 16 KiB limit.
- Draft, title, command, page, envelope, and SQLite values are checked in JavaScript by UTF-8 bytes before persistence/transport; SQLite character-length constraints remain defense in depth rather than the only budget.
- Result and audit structures contain only closed identifiers, states, cursor coordinates, and stable codes. Tests explicitly scan for private paths, attachment content, tool args/results, model reasoning, provider errors, credentials, prompt text, and approval payloads.

### Validation commands

```text
pnpm --filter @workbench/remote-control-contracts typecheck && test
PASS — 17 tests.

pnpm --filter @workbench/remote-control-client typecheck && test
PASS — 12 tests.

pnpm --filter @workbench/pi-runtime-remote-control typecheck && test
PASS — 17 tests.

pnpm --filter @workbench/remote-control-relay-server typecheck && test
PASS — 19 tests.

pnpm --filter @workbench/remote-control-relay typecheck && test
PASS — 21 tests, including the encrypted conversation-control integration.

pnpm --filter @workbench/mobile typecheck && test
PASS — 22 tests.

pnpm --filter @workbench/pi-runtime-server typecheck && test
PASS — 534 tests.

pnpm --filter @workbench/pi-sdk-sessions typecheck && test
PASS — 51 tests.

pnpm check:remote-control-boundaries
PASS.

Focused oxfmt check for all T048–T065 paths
PASS.

Focused oxlint for all modified US2 TypeScript/TSX paths
PASS.

git diff --check
PASS.
```

### Explicitly unexecuted/risk remaining

- No UI/DOM/Hook render test and no UI interaction smoke test was added or run, per repository instruction. The new React Native view was checked statically for light/dark palette coverage, safe-area containment, accessible labels/roles/live regions, multiline draft preservation, and 44-point-or-larger interactive targets.
- No physical-device conversation UI was exercised. Keyboard/IME behavior, very large Dynamic Type, screen-reader traversal, reduced-motion behavior, long-message scrolling, safe-area behavior on notched devices, and perceived streaming performance remain real-device release gates.
- The Android HPKE runtime gate passed earlier, but the conversation screen itself has not been exercised in that emulator. iOS native execution remains unavailable on this Linux host.
- This checkpoint uses the feature's required pre-paired injected remote fixture. Production mobile active-only WSS/AppState/network recovery composition and Runtime-restart snapshot convergence are intentionally assigned to T093–T108; until those tasks are complete, the app composition can display cached conversation state but is not claimed production-ready for remote control.
- Production OIDC/machine provisioning and desktop access-token refresh/rotation gaps recorded in US1 remain open. No deployment, external Relay, EAS build/upload, publishing, source upload, or artifact upload occurred.

## T067–T080 — US3 multi-session management

**Status**: PASS for the pre-paired, deterministic non-UI checkpoint

### Closed management boundary and desktop authority

- The strict operation parser accepts only `session.create`, `session.rename`, `session.setPinned`, and `session.setArchived` with `archived: true`. It rejects restore/unarchive, delete, toggle, `cwd`, path, URI, unknown fields, oversized UTF-8 titles, and malformed entity revisions.
- Workspace projection emits only opaque `workspaceId`, bounded `displayName`, and an explicit default marker. Host `path`, `rootPath`, `cwd`, session attachments, and arbitrary workspace properties are never copied into this catalog.
- The command adapter uses only public `@workbench/pi-rpc-client/api` calls: `createPiRpcSession`, `renamePiRpcSession`, `setPiWorkspaceSessionPinned`, and `archivePiWorkspaceSession`. Its focused transport test observes exactly those RPC method names and no unarchive/delete call.
- Create allocates the durable operation ID as `requestedSessionId` before the local effect. A repeated operation replays its terminal ledger result; if a previous process reached the fixed session creation but not title convergence, the adapter finds that fixed session and applies only the missing set-to-value rename rather than creating another session.
- Rename, pin/unpin, and archive re-read the current authoritative remote-safe state. An already-satisfied target succeeds without a second domain effect, even when a stale optional precondition is supplied. A different target with a stale revision returns `entity_revision_conflict`.
- Organization mutations for the same session are serialized in the desktop operation service. The integration test submits two phone rename requests concurrently with the same starting revision: the first succeeds, the second conflicts, and the first title remains authoritative. Terminal management results carry the new `entityRevision` and the current `appliedCursor`.

### Mobile state, persistence, and UI surface

- `@workbench/remote-control-client/session-management` owns a bounded 200-session reducer with deterministic pinned-first/recent ordering, session switching, per-session draft/read/unread/run state, closed management-operation builders, pending/accepted/awaiting-projection states, and authoritative replacement after a conflict.
- Mobile SQLite schema v3 adds `(machineId, sessionId)` read marker, unread, run state, and LRU metadata while keeping draft text separately bounded to 64 KiB UTF-8. The catalog limit is now 200 across desktop projection, client reducer, mobile feature, and SQLite reads. Catalog replacement does not overwrite an unsent local draft; logout or machine revoke clears the catalog, drafts, local state, conversation cache, and pending operations through the existing scoped cleanup transaction.
- Conversation navigation persists the current draft, read marker, `unread=false` state, and visible run state on initialize, history refresh, draft edit, and run transition. Reopening another session reconstructs its separate state from SQLite; neither snapshot replacement nor switching causes an automatic submit.
- The session list provides new-session creation, pinned and recent groups, fast session opening, unread and execution indicators, rename, pin/unpin, and archive actions. Successful create navigation uses only the authoritative returned session ID. Revision conflicts reload the latest catalog and show a bounded localized message.
- There is deliberately no restore, delete, terminal, file, browser, tool approval, model setting, extension, or Toolbox action in the component or feature command surface. Offline/stale catalog states disable every management mutation.
- All new user-visible and accessibility strings have key parity in `en-US` and `zh-CN`. Static inspection confirms safe-area containment, light/dark palettes, Dynamic Type-capable `Text`/`TextInput`, accessible button/toolbar roles, live conflict feedback, and at least 44-point action targets.

### Integrated behavior and SC-005 proxy

`multi-session-management.integration.test.ts` uses the actual desktop command adapter, operation service, mode-`0600` SQLite operation ledger, session projection, and remote client multi-session reducer. It proves:

```text
fixed-ID create + title convergence
  -> exact operation replay with no second domain effect
  -> two independent session drafts
  -> concurrent two-phone rename conflict
  -> archive succeeds and disappears from active projection
  -> 200-session replace/switch profile
```

- **SC-005 deterministic proxy**: the focused client reducer test replaced, sorted, opened, and updated a 200-session catalog in about 8 ms on this host, below the one-second guard. The wider integration scenario, including SQLite ledger operations, concurrent conflict, archive filtering, and the 200-session profile, completed in about 67 ms. This proves bounded state behavior and a regression budget, not the required reference-phone render/scroll measurement.
- The integration scans published closed results and finds no stale losing title. Active catalog projection excludes the archived session. Exact create replay retains two total create/title domain effects rather than repeating either mutation.

### Validation commands

```text
pnpm --filter @workbench/remote-control-contracts typecheck && test
PASS — 20 tests.

pnpm --filter @workbench/pi-runtime-remote-control typecheck && test
PASS — 22 tests.

pnpm --filter @workbench/remote-control-client typecheck && test
PASS — 15 tests.

pnpm --filter @workbench/mobile typecheck && test
PASS — 23 tests.

pnpm --filter @workbench/remote-control-relay typecheck && test
PASS — 22 tests, including multi-session management integration.

pnpm check:remote-control-boundaries
PASS.

Focused oxfmt and oxlint for all T067–T080 paths
PASS.

git diff --check
PASS.
```

### Explicitly unexecuted/risk remaining

- No UI/DOM/Hook render test and no UI interaction smoke was added or run, per repository instruction. The 200-session budget has not been measured on a reference Android/iOS phone; long-list render/scroll performance, keyboard/IME rename behavior, screen-reader traversal, very large Dynamic Type, and perceived switching latency remain device release gates.
- The current product composition still intentionally has no production active-only WSS/AppState recovery port; that port is T093–T108 work. Consequently, cached multi-session state is available now, while create/rename/pin/archive fail closed as `session_control_unavailable` until the US5 connection owner is composed. This checkpoint does not claim deployed remote management readiness.
- The Android authenticated-HPKE native runtime gate remains valid, but the US3 views were not launched in the emulator. iOS native execution remains unavailable on this Linux host.
- Production machine credential provisioning, desktop OIDC access-token refresh/rotation, deployed Relay/PostgreSQL, external push services, physical devices, EAS/iOS builds, deployment, publishing, and artifact upload were not executed.

## T081–T092 — US4 privacy-safe actionable notifications

**Status**: PASS for the synthetic authoritative-transition and non-UI checkpoint

### Closed hint, registration, and delivery boundary

- `RemotePushHintV1` accepts exactly `version`, `hintId`, `machineId`, optional `sessionId`, and `kind: attention | state-changed`. Strict tests reject title/body, prompt/answer, code/path, tool/error detail, credentials/keys/ciphertext, unknown fields, and payloads above 4 KiB UTF-8.
- The Relay notification service registers only authenticated active mobile devices, rotates the `(account, device, provider, environment)` destination without echoing its token, applies revision-checked removal, reserves a 24-hour transition dedupe key, suppresses active-app and routine transitions, and rechecks both device and machine authorization immediately before delivery.
- PostgreSQL migration 002 adds provider ticket/receipt health and a content-free expiring hint-dedupe table. Provider tokens remain AES-256-GCM encrypted at rest and are decrypted only when constructing the injected delivery request. Rotation clears obsolete ticket/receipt state. `DeviceNotRegistered` changes the registration to `invalid`; revoked/invalid devices are not selected for future delivery.
- The Expo adapter sends one generic notification containing only the closed hint as `data`, with a per-machine/session `collapseId`, Android `tag`, iOS `threadId`, one-day TTL, and high priority. It maps tickets and up to 1,000 receipt IDs without returning provider messages. A 15-minute receipt poll follows Expo's documented guidance. Expo/provider network errors fail as bounded delivery state and are not logged with tokens or content.
- `projectRemoteNotificationIntent` emits only `completed`, `failed`, or `input-needed` intents for a changed authoritative state. Duplicate state, queued/running/stopping progress, streaming deltas, tool activity, and ordinary-input clearing produce no intent.

### Mobile opt-in, persistence, and route authority

- `expo-notifications` is installed at the Expo SDK 57-compatible `~57.0.18` range and registered as a config plugin. The native adapter maps granted/provisional/denied/undetermined permission, obtains a project-bound Expo Push Token, observes token rotation, and installs received/response listeners without importing the native module into pure tests.
- SQLite schema v4 persists at most 500 opaque hint IDs plus the public registration ID/revision. It stores no push body or event log. Account logout/reinstall cleanup removes notification metadata. Restoring remembered IDs does not manufacture a new `needsSync` event.
- Push receipt and tap reducers only set `needsSync` and an opaque route target; they never mutate the last authoritative projection or use push ordering as an event stream. Duplicate and out-of-order hints are harmless, and dropped hints are recovered by the same authoritative refresh path.
- Notification opt-in is explicit. Permission denial preserves `foregroundControlAllowed: true`; a denied permission with an existing server registration triggers best-effort revision-checked removal after account restoration. Token rotation performs a new authenticated PUT. There is intentionally no lock-screen message-preview option.
- The root layout notification listener first requires a current signed-in account, refreshes the authorized machine catalog, requires a non-stale machine match and compatible online protocol, then refreshes and verifies the exact target session before navigation. Invalid, stale, unauthorized, or malformed targets stay on the current safe route. `+native-intent.tsx` preserves only the OAuth callback and routes notification links through this authenticated native-response path.
- Landing UI exposes localized enable/disable/retry states. Mobile and Electron dictionaries contain matching generic completion/failure/input-needed, permission, registration failure, and revoked-registration language in `en-US` and `zh-CN`. No prompt, generated text, path, tool detail, or credential is displayed by these notifications.

### Integrated behavior and SC-006 proxy

`notifications.integration.test.ts` drives 100 background terminal/input-needed transitions through the actual Relay notification service, submits each transition twice, feeds selected hints to the pure client out of order with duplicates and one simulated drop, taps the last hint, verifies the target against an authoritative catalog, and only then clears `needsSync` and routes.

- **SC-006 deterministic proxy**: 100 eligible transitions generated exactly 100 provider deliveries despite 200 publish calls, so 100% generated no more than one delivery in this harness. The privacy scan found no title, prompt, generated content, code/path, tool data, credentials, provider token, or payload above 4 KiB in any hint. The final tap resolved `machine-1/session-99` only after the authoritative revision advanced.
- Active-app transitions generated zero pushes. A validly shaped but unauthorized machine/session hint retained `needsSync` but failed the authorization predicate and did not route.
- This establishes application-level dedupe, privacy, and sync-before-route behavior. It does not claim OS display delivery, latency, coalescing, or a production-provider SLA.

### Validation commands

```text
pnpm --filter @workbench/remote-control-contracts typecheck && test
PASS — 22 tests.

pnpm --filter @workbench/remote-control-relay-server typecheck && test
PASS — 23 tests.

pnpm --filter @workbench/remote-control-client typecheck && test
PASS — 19 tests.

pnpm --filter @workbench/pi-runtime-remote-control typecheck && test
PASS — 24 tests.

pnpm --filter @workbench/remote-control-relay typecheck && test
PASS — 28 tests, including Expo provider and notification integration coverage.

pnpm --filter @workbench/mobile typecheck && test
PASS — 28 tests.

pnpm --filter @workbench/desktop-electron typecheck
PASS.

pnpm check:remote-control-boundaries
PASS.

Focused oxfmt and oxlint for all T081–T092 TypeScript/TSX paths
PASS.

git diff --check
PASS.
```

### Explicitly unexecuted/risk remaining

- No UI/DOM/Hook render test and no UI interaction smoke was added or run. The new notification preference surface was inspected statically for both palettes, Dynamic Type-capable text, accessible button/live-region semantics, and at least 44-point controls.
- Expo Push Service, APNs, FCM, Android Doze, iOS suspension, notification permission system UI, lock-screen display, app-killed delivery, token rotation on real install/reinstall, and tap behavior on physical hardware were not executed. Expo and the underlying providers are best-effort and provide no application-level delivery-time guarantee.
- The Relay has a production Expo adapter and receipt poll, but no external request was sent and no EAS/Apple/Google credential was provisioned or uploaded.
- The live Electron/Pi stream still needs its product-level authoritative transition subscription wired to `projectRemoteNotificationIntent` and the Relay publisher. This checkpoint proves the producer, Relay delivery service, provider adapter, phone listener, and full synthetic path independently; it does not claim a live desktop run generated a physical-device alert.
- Mobile session synchronization still fails closed until the active-only WSS/replay/snapshot owner in T093–T108 is composed. Consequently, notification taps do not show stale content as current; production navigation becomes usable only after that sync phase.

## T093–T108 — US5 authoritative recovery after network changes

**Status**: PASS for deterministic non-UI recovery and convergence; physical network/AppState gates remain open

### Cursor, replay, snapshot, and transactional projection

- The strict v1 codecs accept only canonical decimal uint64 cursors and closed event/snapshot frames. Duplicate, exact-next, gap, epoch-change, `cursor_expired`, and `snapshot_required` outcomes are covered without converting offsets through JavaScript `number`.
- The desktop event ring keeps the intersection of at most 10,000 events, 10 MiB UTF-8, and 15 minutes. A Runtime generation owns a new opaque epoch. Requests before retained history return `cursor-expired`; future offsets return `cursor-gap`; an old Runtime epoch returns `epoch-changed`.
- Snapshot construction captures `baseCursor` before reading the 200-session mobile-safe projection, emits at most 50 sessions and 192 KiB per chunk, buffers concurrent events, sends `snapshot.complete`, then replays the buffer. A 1,000-event/1 MiB concurrent buffer overflow fails closed as `snapshot_required`.
- Mobile SQLite schema v5 stores epoch/offset/stale state with the projection. Snapshot plus base cursor is replaced in one transaction; contiguous event batches use one replacement transaction; storage failure leaves the prior projection intact. Replacement keeps per-session drafts/read markers outside the authoritative projection transaction.

### Active-only recovery, uncertain operations, and Relay fencing

- The phone lifecycle owner opens recovery only when AppState is active and the network is reachable. Background/inactive and offline transitions cancel reconnect timers and suspend the transport, which stops socket heartbeat/reconnect ownership. Foreground, newly reachable network, and push each request one coalesced immediate recovery; failures use capped full-jitter delays from 1 to 30 seconds.
- Machine and conversation presentation now distinguish `offline`, `reconnecting`, `resyncing`, `incompatible`, `stale`, `ready`, and `outcome-checking`. All labels have `en-US`/`zh-CN` parity and a live-region status badge. Session/conversation mutations remain disabled outside authoritative ready state, while local drafts remain editable/persisted.
- A disconnected sending/accepted operation becomes `outcome-unknown`. Recovery asks for the same operation ID through the reconnect resume/status path and never automatically submits its command. When authority reports `operation_not_found`, only a subsequent explicit user retry creates a fresh operation ID. An expired unresolved request is status-checked only and is never automatically re-sent.
- Relay routing immediately rejects commands when no current desktop lease exists, checks command expiry before routing, and fences old desktop lease generations. It stores no pending command body. One MiB of socket pending bytes starts a metadata-only grace window; continued pressure at ten seconds closes the slow consumer with `slow_consumer`. Pending payload count and bytes return to zero after every route attempt.

### SC-004 and deterministic capacity evidence

`network-recovery.integration.test.ts` injects loss of the accepted/terminal acknowledgement after the desktop effect, repeats the same command after a network change, rotates the desktop lease, replaces the Runtime epoch, marks the phone cache stale, and applies a bounded snapshot. The durable operation ledger returns the original terminal result for the original operation ID, so the prompt effect count remains exactly one. The old lease is rejected and the snapshot transaction reaches epoch `runtime-epoch-2` with 200 sessions and `stale=false` in about 65 ms on this host, below the deterministic five-second guard.

- **SC-004 deterministic proxy**: the integrated ack-loss/network/lease/Runtime-restart scenario converged in under five seconds with one domain effect and no automatic stale mutation. This is a controlled local proof, not a production Wi-Fi/cellular p95 measurement.
- The pure-client reference profile replaced 200 sessions with independent multibyte drafts, applied 10,000 exact-next events, and retained the newest 200 multibyte conversation items in about 197 ms. Its encoded retained profile was 101,911 UTF-8 bytes, below the 512 KiB test ceiling.
- The replay suite separately proves count, byte, and time eviction, near-uint64 offsets, concurrent snapshot buffering, overflow, `appliedCursor` convergence, and a new Runtime epoch.

### Validation commands

```text
pnpm --filter @workbench/remote-control-contracts typecheck && test
PASS — 25 tests.

pnpm --filter @workbench/pi-runtime-remote-control typecheck && test
PASS — 29 tests.

pnpm --filter @workbench/remote-control-client typecheck && test
PASS — 24 tests; reference profile about 197 ms / 101,911 retained UTF-8 bytes.

pnpm --filter @workbench/remote-control-relay-server typecheck && test
PASS — 25 tests.

pnpm --filter @workbench/remote-control-relay typecheck && test
PASS — 29 tests, including the network-recovery integration (about 65 ms).

pnpm --filter @workbench/mobile typecheck && test
PASS — 34 tests.
```

### Explicitly unexecuted/risk remaining

- No UI/DOM/Hook render tests or UI interaction smoke tests were added or run, per repository instruction. Connection status and disabled mutation behavior were reviewed statically; the broader final UI/accessibility review is T113.
- Real Wi-Fi↔cellular handoff, airplane mode, captive portal, Android Doze, iOS suspension/termination, push wake, heartbeat timing, radio energy use, and OS AppState ordering were not executed. They remain physical-device release gates.
- The five-second result is a deterministic in-process reference profile. No deployed Relay, real TLS/WSS path, packet loss emulator, production identity provider, mobile radio, or multi-region latency was measured.
- Active-only lifecycle and network adapters are implemented and independently composed behind the mobile remote-client transport port. Final production credential provisioning, live WSS business-frame composition, and release-build gates remain subject to the cross-cutting T109–T120 review; no deployment or external upload occurred.

## T109–T117 — Cross-cutting hardening, UI review, documentation, and test matrix

**Status**: PASS

### Privacy, dependency boundaries, security, and i18n

- `scripts/remote-control-privacy-audit.test.mjs` scans Relay schema/log fixtures/push/error surfaces, desktop projections, mobile persistence, and the sealed-frame boundary. The audit rejects prompt/title/path/answer/tool arguments/results, bearer material, key material, and ciphertext bodies outside their owners.
- `scripts/check-remote-control-boundaries.mjs` enforces the planned owner graph: mobile cannot import desktop Shell/UI, Pi Runtime, or Toolbox capabilities; Relay cannot import Pi; contracts cannot import React or Node runtime APIs; the desktop bridge cannot deep-import application/private StreamHub internals; remote-control packages cannot use undeclared deep imports or dependency cycles.
- `apps/remote-control-relay/tests/security-regression.integration.test.ts` aggregates pairing races, credential audience/scope/rotation, ticket and DPoP replay, revocation of active sockets, E2EE tampering, rate/size/depth limits, and credential-free audit assertions.
- Mobile and desktop settings i18n parity tests prove matching `en-US`/`zh-CN` keys and interpolation variables, `en-US` final fallback, complete remote error-code mapping, and preservation of user content, stable IDs, commands, and paths.

```text
node --test scripts/remote-control-privacy-audit.test.mjs scripts/check-remote-control-boundaries.test.mjs
PASS — 8/8 tests.

pnpm check:remote-control-boundaries
PASS.
```

### Static UI and accessibility review

The review was static by repository policy; no UI/DOM/Hook render test or UI interaction smoke was added or run.

- Mobile routes and screens consistently use `SafeAreaProvider`/`SafeAreaView`; paired-machine, session-list, conversation, pairing, settings, and authentication flows avoid unbounded desktop layouts.
- Interactive controls expose `accessibilityRole`, translated `accessibilityLabel`, and live-region/status semantics where state changes require announcement. Action rows and buttons retain a minimum 44-point touch target.
- User-visible mobile and desktop settings text is sourced from paired `en-US` and `zh-CN` bundles. Dynamic Type is not disabled (`allowFontScaling={false}` is absent), and text inputs use the platform text stack.
- `apps/mobile/src/ui/theme.ts` projects the system light/dark preference through semantic theme values. Mobile screens use those values rather than desktop Shell tokens; desktop settings continue to reuse shared controls and semantic Workbench tokens, preserving density and radius configuration.
- The mobile product adds no custom animation or Reanimated dependency, so it does not introduce motion that needs a reduced-motion override. System navigation/transitions remain platform-owned.
- Static source and boundary scans found no Toolbox, terminal, remote browser, file explorer, model/provider management, extension management, or desktop Shell surface. `expo-web-browser` is used only to hand OAuth authentication to the system browser and is not a remotely controlled browser capability.

### Documentation and repository scripts

- The four new library READMEs document owner boundaries, public entry points, protocol/storage budgets, active-only lifecycle, unsupported capabilities, and focused validation in English and Chinese.
- Root, mobile, and Relay package scripts provide Expo dependency checking, Doctor, production export, local Android release compilation, Relay build/migration dry-run, boundary checks, and the aggregate focused remote-control suite. They do not implicitly add mobile or Relay work to the pre-existing desktop `pnpm build` contract.
- `pnpm install --frozen-lockfile` completed for all 107 workspace projects. `pnpm mobile:expo-check` reported dependencies up to date, and `pnpm mobile:doctor` passed 21/21 checks.
- The mobile suite proves that the workspace resolves one Expo-compatible React/React Native runtime. A read-only lockfile scan found no `package-lock.json`, `yarn.lock`, or `yarn-error.log` outside dependency/generated Android directories; `pnpm-lock.yaml` remains authoritative.

### Exact focused non-UI suite

Cross-application integration harnesses live under `scripts/` so that the test graph does not create undeclared app-to-app dependencies. Thin formal entrypoints remain under `apps/remote-control-relay/tests/` and dynamically import those repository-owned harnesses.

```text
pnpm test:remote-control
PASS — 182/182 tests:
  @workbench/remote-control-contracts       28
  @workbench/remote-control-client          24
  @workbench/remote-control-relay-server    26
  @workbench/pi-runtime-remote-control      34
  @workbench/remote-control-relay app       33
  @workbench/mobile pure logic              37

node --test apps/desktop-electron/test/remote-control-lifecycle.test.cjs
PASS — 4/4 tests.

node --check apps/desktop-electron/src/desktop-remote-control.cjs
node --check apps/desktop-electron/src/main.cjs
PASS.
```

The Relay suite, including the formal closed loop, passed three consecutive runs after receive-order serialization was added. The remote-client reducer/reference profile processed 200 retained sessions in about 223 ms with 101,911 retained UTF-8 bytes.

## T121–T126 — Speckit convergence closure

**Status**: PASS

The `speckit-converge` review found six production-composition gaps after the original T001–T120 implementation. T121–T126 were appended to `tasks.md`; all six are now closed.

### T121 — Complete encrypted control contracts

- Strict codecs now cover encrypted and bounded session catalog, conversation history, cursor replay/snapshot, and operation-status request/response control messages.
- Contract tests reject unknown fields, oversized fields and collections, malformed cursors, invalid operation identifiers, unsupported versions, and plaintext business content at the Relay boundary.
- Relay-visible routing metadata is separated from HPKE-sealed business content.

### T122 — Formal desktop composition

- The production Electron observer now composes frame authentication/decryption, per-request authorization, Pi command mapping, durable SQLite operation ledger, event ring, snapshot/replay, encrypted response frames, and Runtime-generation lifecycle cleanup.
- The bridge projects the Pi RPC catalog through an explicit sanitizer rather than forwarding private Runtime state.
- Packaging now bundles the complete production closure into `electron/desktop-remote-control.cjs`. The packaged file contains no unresolved `@workbench/*` runtime import and can be required by Node to obtain `createDesktopRemoteControlBridgeGeneration`.

### T123 — Formal mobile transport composition

- Mobile active-only WSS uses socket ticket plus proof, credential-free URLs, HPKE-sealed requests/results, request correlation, cursor recovery, operation-status recovery, durable projection state, and the planned machine/session/conversation ports.
- A formal closed-loop run exposed an ordering race: WebSocket frames arrived in order, but independent asynchronous HPKE decryptions could project snapshot chunks, completion, and events out of order. The transport now serializes receive processing per connection and fails the stream coherently. Three consecutive Relay suites and the final aggregate suite passed after the correction.

### T124 — Notification intent composition

- The desktop Runtime observer maps only authoritative completed, failed, and input-needed transitions into content-free notification intents.
- Active-app suppression, deduplication, explicit-stop handling, revocation recheck, and Relay hint routing are covered without exposing conversation content.

### T125 — Formal production-path closed loop

- `apps/remote-control-relay/tests/formal-closed-loop.integration.test.ts` enters the repository integration harness through the real mobile transport, production Relay business-frame handler/router, desktop frame processor/command adapter, and SQLite ledger.
- It covers initial machine/session catalog and snapshot, history, message send, stop, rename/manage, background/foreground reconnect, cursor/snapshot recovery, and revocation. It does not replace the production transport with the earlier test-only remote seam.

### T126 — Production Relay sealed-frame handler

- The handler resolves account, machine, device, and current lease before routing opaque business frames.
- Responses are limited to bounded receipt/error envelopes; audit entries are metadata-only; no frame body is persisted, inspected, or logged.
- Focused tests cover routing, stale/foreign leases, frame limits, opaque payload preservation, credential-free audit, and active-socket revocation.

## T118 — Production build artifacts

**Status**: PASS for local/configured build gates; external signing, deployment, and upload remain unexecuted.

### Mobile

```text
pnpm mobile:export:production
PASS — iOS Hermes bundle 3.9 MB; Android Hermes bundle 4.1 MB.

pnpm mobile:android-release
PASS — 670 Gradle tasks (642 executed, 28 up-to-date), about 4m58s.
```

- Android APK: `apps/mobile/android/app/build/outputs/apk/release/app-release.apk`
- Size: 174,888,911 bytes
- SHA-256: `f95ddf2c831d0375dc91d9551bd96e591f5cb1c83226bda663e4a414c3ed9402`
- The APK contains QuickCrypto/NitroModules/React Native libraries for all four packaged ABIs. The test-only native HPKE marker is absent from the production JS bundle.
- The Android emulator native-HPKE harness passed earlier in the implementation after the user explicitly authorized emulator execution. This is separate from the repository's prohibited UI interaction smoke testing.

### Relay

```text
pnpm relay:build
PASS — dist/main.mjs 71.5 KB; source map 134.1 KB.

pnpm relay:migrate:dry-run
PASS — migration 1 SHA-256 fb85bf76ecd604ea9de956aee7b982ed4c9dd462c20daf72c35c2763d3ba85b3
       migration 2 SHA-256 e448b05d51cf47a6a4caa6abcaf35f1028cf27409f8f93fa25c77def209dfa22
```

### Desktop Electron

```text
pnpm --filter @workbench/desktop-electron run pack:artifact
PASS — renderer 78.9 MiB; Runtime child 39.2 MiB; 4,890 files.

node --test apps/desktop-electron/test/prepare-package.test.cjs \
  apps/desktop-electron/test/desktop-runtime-budget.test.cjs
PASS — 8/8 tests.
```

- Executable: `dist-electron/linux-unpacked/pi-workbench`
- Size: 221,097,208 bytes
- SHA-256: `933487402a8ccb7de988e016827107b4c351bafe56a635120336896b74b414b3`
- Packaged remote bridge: `dist-electron/linux-unpacked/resources/app/electron/desktop-remote-control.cjs`
- Remote bridge size: 788,892 bytes
- Remote bridge SHA-256: `9b1f801083c3180988b88d68a0e837d8dd7ac5b8fc94d7a22e03623d29a18042`
- The packaging step now bundles and validates the bridge's production dependency closure; the artifact contains no unresolved `@workbench/` import. Full packaged-app launch is not part of the artifact-only command and remains an explicit release gate.

No EAS cloud build, Apple signing, distribution signing, store upload, source upload, artifact upload, or external deployment was performed.

## T119 — Full repository quality gates

**Status**: PASS

```text
pnpm lint
PASS — 3,154 files formatted/checked with no warning output.

pnpm format
PASS — 3,154 files.

pnpm typecheck
PASS — 6 applications and 100 packages.

pnpm check:workspace-dependencies
PASS.

pnpm check:package-structure
PASS — 100 libraries, 588 test files, 0 tracked migration violations.

pnpm build
PASS — Runtime Node, Next.js web, desktop renderer, and Electron runtime artifact.

git diff --check
PASS.
```

No unexplained baseline failure remains. Unrelated pre-existing/user worktree changes were preserved.

## T120 — Final specification, plan, contract, and implementation consistency

**Status**: PASS for implementation coverage and deterministic non-UI evidence. The outcome metrics that inherently require production services, physical devices, or usability observation remain explicit release gates below and are not represented as measured production results.

### Functional requirement coverage

| Requirement | Implementation and evidence                                                                                                                               |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| FR-001      | Pairing contracts, Relay pairing service, mobile pairing flow, desktop pairing entry, single-use expiry/race tests.                                       |
| FR-002      | Device listing, naming, revocation, credential rotation, logout cleanup, audience/scope enforcement, and active-socket revocation tests.                  |
| FR-003      | Account-scoped machine projection, connection/presence state, empty/offline states, and mobile machine navigation.                                        |
| FR-004      | Sanitized desktop Pi session catalog, encrypted catalog request/response, bounded paging, mobile session projection/list.                                 |
| FR-005      | Encrypted conversation history/snapshot contracts, desktop projection, durable mobile conversation store, bounded message rendering model.                |
| FR-006      | Idempotent `session.create` operation through the Pi command adapter, ledger, formal closed loop, and recovery tests.                                     |
| FR-007      | Idempotent message send with operation IDs, draft preservation, outcome recovery, and single-effect assertions.                                           |
| FR-008      | Stop command with explicit-stop semantics, authoritative completion, ledger replay, and formal closed-loop coverage.                                      |
| FR-009      | Rename/manage command mapping, authorization, ledger state, catalog refresh, and closed-loop coverage.                                                    |
| FR-010      | Durable SQLite operation ledger and per-session idempotency/order handling across reconnect/Runtime generation.                                           |
| FR-011      | Bounded event ring, cursor replay, snapshot chunking, overflow fallback, epoch reset, and serialized mobile receive projection.                           |
| FR-012      | Operation-state ledger and correlated pending/committed/outcome-unknown recovery without blind resend.                                                    |
| FR-013      | Offline/reconnecting/stale UI state, draft retention, retry/reconcile rules, active-only transport lifecycle, and network-recovery suite.                 |
| FR-014      | Authoritative content-free notification intents for completed/failed/input-needed with suppression, dedupe, stop, and revoke checks.                      |
| FR-015      | Relay push hints contain routing/type metadata only; notification privacy audit rejects content-bearing fields.                                           |
| FR-016      | Persisted cache freshness/stale markers, per-account/machine scope, bounded retention, and online resynchronization.                                      |
| FR-017      | Mobile dependency/source boundary rejects desktop UI/Shell, Runtime, Pi, Toolbox, deep imports, and cycles.                                               |
| FR-018      | Explicit session/conversation projection sanitizer and tests prevent prompt/tool/private Runtime leakage beyond allowed user-facing data.                 |
| FR-019      | HPKE sealed frames, ticket/proof binding, request authorization, key storage adapters, tamper/replay/rotation/revocation tests, and opaque Relay routing. |
| FR-020      | Mobile device management and logout revoke credentials, sockets, notification registration, cache, ledger projection, and secure keys.                    |
| FR-021      | Version/capability negotiation, update-required/unsupported states, bounded codecs, and incompatible-version tests.                                       |
| FR-022      | Credential-free, content-free structured audit with retention/size constraints and privacy/security regression scans.                                     |
| FR-023      | Paired `en-US`/`zh-CN` bundles, interpolation parity, fallback/error mapping tests, and non-translation of stable/user content.                           |
| FR-024      | Manual pairing entry, notification-permission controls, recovery copy, accessibility labels, and localized states without requiring camera access.        |

### Success-criteria evidence and measurement boundary

| Criterion | Deterministic evidence                                                                                                                        | Remaining real-world measurement                                                                                                        |
| --------- | --------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| SC-001    | Pairing state machine, expiry/retry/recovery, manual entry, and first-attempt deterministic flows pass.                                       | The “90% of first-time users within two minutes” target requires moderated/unmoderated physical-device usability measurement.           |
| SC-002    | Formal production-path catalog/history closed loop completes well below two seconds locally.                                                  | Production p95 requires deployed Relay/TLS/WSS, production identity, representative desktop load, radio networks, and reference phones. |
| SC-003    | Send/stop/manage operations reach authoritative UI state well below two seconds locally.                                                      | Production p95 and user-perceived timing require the same deployed/reference-device measurement.                                        |
| SC-004    | Forced-disconnect recovery converges within five seconds in deterministic integration tests with exactly one effect.                          | Real Wi-Fi/cellular handoff, packet loss, captive portal, suspend/kill, and regional latency remain device/network gates.               |
| SC-005    | The 200-session retained-state profile completes in about 223 ms and 101,911 bytes, with bounded per-screen projection.                       | Reference-device render/input-latency and memory measurement remain physical-device gates.                                              |
| SC-006    | 100 synthetic terminal transitions produce exactly one content-free notification intent each, including input-needed and explicit-stop cases. | APNs/FCM delivery, tap-to-target behavior, Android Doze, and iOS suspension/termination require OS/device testing.                      |
| SC-007    | Boundary, capability-negotiation, privacy, and security suites expose zero Toolbox routes/imports and reject forbidden content.               | Independent product/security review remains advisable before public release.                                                            |
| SC-008    | Revocation immediately closes the targeted lease/socket in the formal loop while another authorized device remains independent.               | The one-minute public SLA requires a deployed multi-device, multi-region measurement.                                                   |
| SC-009    | i18n parity, fallback, error-code coverage, and content-preservation tests pass for both base locales.                                        | Final visual localization review on phone form factors remains a release gate.                                                          |

### Explicitly unexecuted release and external gates

- No UI/DOM/Hook render test or UI interaction smoke test was added or run, in accordance with the repository instruction. UI and accessibility were reviewed statically.
- No physical-phone usability study, Dynamic Type screenshot pass, screen-reader traversal, touch ergonomics study, SC p95 production benchmark, or reference-device memory/render profile was run.
- No real Wi-Fi↔cellular handoff, airplane mode, captive portal, packet-loss environment, Android Doze, iOS suspension/termination, push wake, or OS process-kill scenario was run.
- No deployed Relay/PostgreSQL/OIDC/TLS/WSS/push environment, production identity provider, APNs/FCM delivery, regional failover, or multi-device public-SLA measurement was used.
- iOS native compilation was not available on the Linux host. EAS/iOS configurations are present, but no EAS build, signing, TestFlight/App Store, Play Store, source upload, artifact upload, or external deployment occurred.
- The local Android release APK proves compilation and native linkage; it is not represented as a store-signed/distribution-approved release.
- Electron artifact-only packaging passed, but a full installed packaged-application execution smoke was not run.
- No independent cryptographic audit, penetration test, privacy/legal assessment, or external security certification was performed.

## T127–T130 — Shared desktop conversation presentation on mobile

**Status**: PASS for implementation, static boundaries, pure model behavior, dependency compatibility, and Android production export. Physical-device visual and interaction behavior remains an explicit release gate.

```text
pnpm --filter @workbench/ui-remote-conversation typecheck
PASS.

pnpm --filter @workbench/mobile typecheck
PASS.

pnpm --filter @workbench/ui-remote-conversation test
PASS — 2/2 pure projection/transcript tests.

node --test scripts/check-remote-control-boundaries.test.mjs
PASS — 4/4 tests.

pnpm check:remote-control-boundaries
PASS.

pnpm check:workspace-dependencies
PASS.

pnpm check:package-structure
PASS — 103 libraries, 605 test files, 0 tracked migration violations.

pnpm --filter @workbench/mobile expo:check
PASS — Expo SDK dependencies are current.

EXPO_NO_BUNDLE_SPLITTING=1 NODE_ENV=production pnpm --dir apps/mobile exec expo export --platform android --output-dir dist
PASS — native Android bundle plus embedded DOM conversation bundle exported.
```

The Expo SDK 57 exporter currently loses the generated shared `__common` asset while serializing this large isolated DOM component, so the app-local export scripts explicitly disable bundle splitting. Development Fast Refresh remains enabled. The export also reports that relative KaTeX font URLs are not copied into the DOM bundle; diagrams are disabled in this host and formula-font packaging remains a device release gate.

`expo-doctor` passes 20/21 checks. Its duplicate-dependency check sees the desktop workspace packages' React/ReactDOM 19.2.8 development installs in addition to Expo's 19.2.3 pair. Metro explicitly resolves linked workspace imports to the mobile app's matching React and ReactDOM 19.2.3 entrypoints, and the production export passes, but the doctor warning is retained rather than represented as a pass.

No UI/DOM/Hook render test or UI interaction smoke was added or run. The embedded surface has not yet been manually inspected on a physical phone for startup latency, memory pressure, scrolling, disclosure, copy/link behavior, accessibility traversal, keyboard coexistence, or formula rendering.

### T131 — Expo DOM WebView teardown race

**Status**: PASS for reproducible dependency patching, static validation, emulator development bundling, and Android production export. No UI interaction smoke was run.

The SDK 57 DOM wrapper can issue an asynchronous `DomWebView.injectJavaScript` command while React is removing the corresponding native view. Android then rejects the command because its numeric React tag no longer resolves to a `DomWebView`, and the upstream imperative wrapper leaves that Promise unhandled. `patches/@expo__dom-webview@57.0.1.patch` settles native view commands and ignores only the exact destroyed-view error while continuing to report unrelated command failures. The mobile session screen also memoizes the DOM component, preserves the projected item array identity, and stabilizes the load-more callback and DOM options so ordinary native re-renders do not generate redundant property injection.

```text
pnpm install --frozen-lockfile
PASS — the @expo/dom-webview 57.0.1 patch is reproducibly installed from pnpm-workspace.yaml.

pnpm --filter @workbench/mobile typecheck
PASS.

pnpm --filter @workbench/mobile expo:check
PASS — dependencies are current for Expo SDK 57.

pnpm check:remote-control-boundaries
PASS.

EXPO_NO_BUNDLE_SPLITTING=1 NODE_ENV=production pnpm --dir apps/mobile exec expo export --platform android --output-dir dist
PASS — Android bundle 1,627 modules; embedded DOM conversation bundle 6,584 modules; exported to dist.
```

The alternative `react-native-webview` backend was evaluated but not retained: it would require an unnecessary native client rebuild, and that build could not download Maven artifacts in this environment because the configured repository returned HTTP 403. The final fix uses the already-linked Expo native module and does not leave `react-native-webview` in the manifest or lockfile.

### T132 — Expo DOM React renderer consistency

**Status**: PASS for deterministic module resolution, emulator development bundling, static validation, and Android production export. No UI interaction smoke was run.

The first shared conversation DOM development bundle failed before rendering because Metro resolved hook imports to the mobile app's React 19.2.3 but selected the desktop workspace's ReactDOM 19.2.8 for the DOM renderer. `extraNodeModules` alone is a fallback and did not override the nearer pnpm workspace copy. `apps/mobile/metro.config.cjs` now uses an explicit resolver mapping for React, the JSX runtime entrypoints, ReactDOM, and `react-dom/client`, while retaining package-root mappings for ordinary package resolution. The DOM bundle therefore uses the same React 19.2.3 pair required by Expo SDK 57.

```text
pnpm exec oxfmt --check apps/mobile/metro.config.cjs
PASS.

pnpm --filter @workbench/mobile typecheck
PASS.

pnpm --filter @workbench/mobile expo:check
PASS — dependencies are current for Expo SDK 57.

pnpm check:remote-control-boundaries
PASS.

EXPO_NO_BUNDLE_SPLITTING=1 NODE_ENV=production pnpm --dir apps/mobile exec expo export --platform android --output-dir dist
PASS — Android bundle 1,627 modules; embedded DOM conversation bundle 6,578 modules; exported to dist.
```

After restarting Metro with an empty cache and opening the existing `Hello` session in the local emulator, the DOM bundle logged `Running application "main"` and remained free of the earlier `Invalid hook call`, `ErrorToastContainer`, and `WorkbenchSettingsProvider` failures. Metro remains active on port 8082 for subsequent Fast Refresh work.

### T133–T134 — Canonical desktop conversation nodes and lifecycle de-duplication

**Status**: PASS for canonical projection, closed protocol parsing, shared renderer integration, cache replacement, live authoritative refresh, type checks, and pure non-UI tests. Physical-device visual and interaction behavior remains an explicit release gate.

The previous mobile surface reused selected desktop visual primitives but still reconstructed a separate transcript from simplified remote items. That discarded the desktop context-composition data blocks and could not retain the full canonical tool-call lifecycle. The desktop bridge now builds history with the same Pi conversation adapter used by the desktop runtime, projects a closed and UTF-8-bounded subset of those canonical nodes, and the mobile DOM surface mounts the real desktop conversation list/node/message/tool renderers through a minimal read-only runtime adapter. File/source blocks, arbitrary renderer metadata, credentials, and unrestricted Runtime/Pi RPC remain excluded.

Live Pi lifecycle events are not treated as a second render model. The mobile session controller coalesces those notifications into an authoritative history re-read, ensuring tool arguments, bounded raw results, reasoning, and context-composition summaries remain consistent with the desktop node model. Legacy cached item variants remain readable until the first successful replacement.

```text
pnpm --filter @workbench/remote-control-contracts typecheck
pnpm --filter @workbench/remote-control-contracts test
PASS — 37/37 tests.

pnpm --filter @workbench/pi-runtime-remote-control typecheck
pnpm --filter @workbench/pi-runtime-remote-control test
PASS — 31/31 tests, including canonical node projection and lifecycle de-duplication.

pnpm --filter @workbench/ui-remote-conversation typecheck
pnpm --filter @workbench/ui-remote-conversation test
PASS — 3/3 pure projection/rehydration tests.

pnpm --filter @workbench/mobile typecheck
pnpm --filter @workbench/mobile test
PASS — 44/44 tests, including authoritative latest-page replacement and live canonical history refresh.

pnpm check:remote-control-boundaries
pnpm check:workspace-dependencies
PASS — canonical Pi adapter is an explicit bridge-only dependency; the mobile app still imports desktop presentation only through the dedicated DOM boundary.

EXPO_NO_BUNDLE_SPLITTING=1 NODE_ENV=production pnpm --dir apps/mobile exec expo export --platform android --output-dir dist
PASS — Android bundle 1,627 modules; canonical shared conversation DOM bundle 6,997 modules; exported to dist.
```

The existing KaTeX relative-font asset warning remains unchanged; formula-font packaging is still a physical-device release gate. No UI/DOM/Hook render test or UI interaction smoke was added or run. Metro was reloaded to deliver the implementation, and the rebuilt desktop remote bridge reached ready state with both Pi event streams connected.

### T135 — Remote read-only renderer environment

**Status**: PASS for provider composition, optional-capability isolation, affected owner tests, type checks, boundary checks, development rebundle, and Android production export.

The desktop message renderer requires a `WorkbenchAgentRuntimeEnvironment` even for read-only Composer-document presentation. The remote surface now provides a stable runtime ID, current thread ID, and an empty command catalog, while omitting workspace files, model controls, thread mutations, and other unsupported capabilities. The shared `WorkbenchMessagePresentation` exposes an explicit default-on `showFileChanges` option; only the remote renderer disables it, avoiding a fake `RightWorkspaceProvider` and preserving existing desktop behavior.

```text
pnpm --filter @workbench/ui-conversation-nodes typecheck
pnpm --filter @workbench/ui-conversation-nodes test
PASS — 39/39 tests.

pnpm --filter @workbench/ui-remote-conversation typecheck
pnpm --filter @workbench/ui-remote-conversation test
PASS — 3/3 tests.

pnpm --filter @workbench/mobile typecheck
pnpm check:remote-control-boundaries
PASS.

EXPO_NO_BUNDLE_SPLITTING=1 NODE_ENV=production pnpm --dir apps/mobile exec expo export --platform android --output-dir dist
PASS — Android and shared DOM bundles exported to dist; the unchanged KaTeX relative-font warning remains.
```

Metro completed a fresh Android reload and rebuilt the 6,997-module DOM surface without a subsequent provider error in its output. No UI/DOM/Hook render test or UI interaction smoke was added or run.
