# Validation: Direct Paired Mobile Access

**Feature**: `014-direct-paired-access`<br>
**Started**: 2026-09-13<br>
**Implementation status**: Implementation complete; deterministic gates closed, with the physical-device and independent release gates below intentionally unexecuted

This file records task-level command evidence. A task is checked only after the implementation and focused validation named in `tasks.md` pass. No UI/DOM/Hook render test or UI interaction smoke is added or run. Physical-device LAN/Tailscale, firewall, operating-system lifecycle, accessibility, signing, deployment, and external security checks remain explicit release gates.

## T001 — Migration baseline

**Status**: PASS

### Repository state

- Git branch: `codex/package-refactor`.
- Active Speckit feature: `specs/014-direct-paired-access` via `.specify/feature.json`.
- Baseline library package count before the direct-server replacement: 100.
- The worktree is intentionally dirty with pre-existing/user work across Pi, UI, workspace, and other packages. Spec 013 mobile/remote-control files are also uncommitted implementation from the immediately preceding authorized work. All unrelated changes are preserved; no reset, checkout, clean, or broad deletion is permitted.
- Existing `.gitignore` already covers dependency/build output plus Expo/mobile native/export and Electron artifacts. The pnpm workspace includes `apps/*` and `packages/server/*`; no ignore or workspace edit is required for the target package.

### Baseline retained-capability tests

```text
pnpm --filter @workbench/remote-control-contracts test
PASS — 28/28 tests.

pnpm --filter @workbench/pi-runtime-remote-control test
PASS — 34/34 tests.

pnpm --filter @workbench/remote-control-client test
PASS — 24/24 tests; 200-session/10,000-event reference profile about 202.4 ms and 101,911 retained UTF-8 bytes.

pnpm --filter @workbench/mobile test
PASS — 37/37 tests.
```

The passing baseline proves the work that Spec 014 must retain while replacing identity/topology: RFC 9180 HPKE interoperability, closed multi-session command/query/result unions, hostile Pi projection sanitization, durable operation idempotency/crash reconciliation, bounded cursor/replay/snapshot behavior, per-session mobile state, SecureStore/SQLite separation, active-only lifecycle, and ordered mobile frame processing.

### Superseding requirement

- No Workbench account, OAuth/OIDC, access token, refresh token, central Relay, PostgreSQL identity/device registry, central push service, public discovery, NAT traversal, or port-forwarding workflow.
- Reachability is limited to an explicitly selected same-LAN address or a user-provided Tailscale IP/MagicDNS name.
- QR is the primary bootstrap; manual host/IP + port + one-time code is the fallback.
- A dedicated Electron direct gateway is allowed to listen on selected addresses; the existing Runtime remains loopback-only and never becomes the remote network API.
- The allowed product surface remains multi-session read/create/send/stop/rename/pin/archive, ordinary-question response, and read-only viewing of every user-visible assistant message plus bounded textual tool transcripts. Every Toolbox/terminal/file/browser/extension/model/provider/arbitrary-tool/sensitive-approval command route remains absent.

## T002 — Historical architecture notice

**Status**: PASS

Spec 013 `spec.md`, `plan.md`, and `validation.md` now carry a concise superseded-topology notice linking to Spec 014. Its completed evidence was not rewritten or represented as the current release architecture.

## T004 — Ignore/workspace verification

**Status**: PASS

- `pnpm-workspace.yaml` already includes `apps/*` and `packages/server/*`.
- `.gitignore` already covers `node_modules`, general build output, Expo state/native/export output, Electron output, logs, temporary editor files, and environment files through existing project patterns.
- The direct-server package produces no repository build directory in its focused typecheck/test workflow. No speculative ignore entry was added.

## T003 — Direct-server package skeleton

**Status**: PASS

- Added `@workbench/remote-control-direct-server` under the required `packages/server/remote-control-direct-server` leaf.
- Package metadata uses explicit source exports, the shared strict TypeScript base, package-root test discovery, and only the remote-control contract as a production dependency.
- Bilingual owner/boundary READMEs explicitly exclude Electron, Pi/Runtime, React, Tailscale control-plane integration, account/OIDC, PostgreSQL, push, public discovery, NAT traversal, and a deployed Relay.
- No Relay provider implementation or placeholder helper was copied. The root entry already owns the real fixed direct socket-path contract; later foundation tasks add the address/gateway entries together with their tested implementations.

```text
pnpm --filter @workbench/remote-control-direct-server typecheck
PASS.
```

Adding the new workspace importer caused pnpm to reconcile the existing lockfile. The operation used pnpm, reported the lockfile already up to date after adding the importer, and did not create an npm/yarn lockfile.

## T005–T014 — Foundational direct trust and protocol

**Status**: PASS

- Added closed account-free direct endpoint, pairing payload/hello/claim/result, device authorization, fresh challenge/authentication/acknowledgement, stable error, and direct sealed-envelope types/codecs. Legacy Spec013 codecs remain temporarily available only so the product can be replaced behind passing compatibility tests; direct parsers reject legacy account, Relay, bearer, ticket, and lease fields.
- Added a separate RFC 9180 authenticated-mode direct HPKE domain. Machine ID, device ID, direction, content type, key ID, timestamps, and envelope identity are canonical AAD. Tests prove a routing-header substitution cannot decrypt.
- Added private/Tailscale address classification for RFC1918, CGNAT, IPv6 ULA, Tailscale IPv6, `.local`, `.ts.net`, and single-label MagicDNS-style names. Public, wildcard, multicast, unspecified, loopback, link-local, scheme/credential/path/query/fragment injection, invalid kind, and invalid port cases fail closed. Derived URLs contain only `ws`, canonical host/port, and `/remote/v1/direct`.
- Added the reusable direct-server ports, limits, bounded error codes, diagnostic redaction, listener/pairing states, and explicit exports.
- Added account-free multi-computer client profiles, identity pinning, endpoint ordering, direct pairing state, direct challenge signing, direct acknowledgement/envelope validation, suspension, terminal mismatch/revocation states, and full-jitter reconnect behavior. Existing cursor, operation, conversation, and session behavior remains passing.
- Extended boundary and privacy fixtures for direct-service dependency isolation, central-service fields, public endpoint literals, and pairing/challenge/key/ciphertext material.
- Updated all three foundational package READMEs in `en-US` and `zh-CN` with Spec014 ownership and lifecycle. No UI/DOM/Hook test or UI interaction smoke was added or run.

```text
pnpm --filter @workbench/remote-control-contracts typecheck
PASS.
pnpm --filter @workbench/remote-control-contracts test
PASS — 36/36 tests.

pnpm --filter @workbench/remote-control-direct-server typecheck
PASS.
pnpm --filter @workbench/remote-control-direct-server test
PASS — 3/3 tests.

pnpm --filter @workbench/remote-control-client typecheck
PASS.
pnpm --filter @workbench/remote-control-client test
PASS — 30/30 tests; the retained 200-session/10,000-event profile remained under one second.

node --test scripts/check-remote-control-boundaries.test.mjs scripts/remote-control-privacy-audit.test.mjs
PASS — 9/9 tests.
node scripts/check-remote-control-boundaries.mjs
PASS.
```

## T015–T026 — Account-free direct pairing

**Status**: PASS

- The desktop direct listener is disabled by default and binds only the exact selected private-LAN/Tailscale interfaces. Configuration is persisted before the lifecycle change; a failed candidate bind is disposed while the previous healthy generation remains active.
- QR and manual host/port/one-time-code paths use the same short-lived, single-use invitation and canonical safety transcript. The phone generates a separate P-256 signing identity and HPKE recipient identity for every paired computer. The desktop must confirm the matching six-digit safety code before it persists and returns a revocable authorization.
- Pairing attempts are byte-, frame-, time-, connection-, and attempt-bounded. Expired, denied, cancelled, locked, already consumed, concurrently reused, or restart-invalidated invitations fail closed without business data.
- Electron stores the installation private identity, direct listener configuration, and phone public authorizations only in a `safeStorage`-encrypted document. Its renderer contract receives display-safe configuration, addresses, pairing status, safety code, and device metadata only.
- Mobile commits SecureStore credentials before the SQLite profile becomes visible and cleans partial keys on failure/cancellation. There is no signed-out state, account provider, OAuth redirect, bearer token, or notification registration.
- The desktop settings UI reuses shared `Button`, `Input`, `Switch`, `SettingsGroup`, `SettingsRow`, `StatusBadge`, semantic tokens, and existing density/radius behavior. The mobile screens use `SafeAreaView`, automatic light/dark palettes, Dynamic Type defaults, localized accessibility text/live regions, and 44-point-or-larger actionable controls. This was a static source review only, as required by repository policy.

The production pairing integration exercises both QR and manual paths over the real direct protocol and reports:

```text
node --import tsx scripts/remote-control-direct-pairing.integration.test.ts
PASS — 1/1 integration test.
```

## T027–T036 — Direct multi-session control

**Status**: PASS

- Every normal connection starts with a fresh desktop challenge. The phone verifies the pinned machine/key identity, signs the canonical P-256 challenge, negotiates protocol v1, and only then exchanges HPKE authenticated-mode envelopes.
- Unknown/revoked devices, authorization revision drift, capability drift, challenge replay, unanswered challenge timeout, endpoint mismatch, identity mismatch, business-before-auth, envelope replay, and disable/revoke races close the connection before an effect.
- The Electron adapter uses Node `http` plus bundled `ws`, the fixed `/remote/v1/direct` upgrade path, disabled compression, a 1 MiB immediate backlog ceiling, and a 10-second sustained send timeout. It does not expose the existing loopback Runtime listener.
- The Pi owner keeps the closed mobile projection and command surface: session catalog/history/status/snapshot; create, send text, stop, rename, set pin, archive; and bounded ordinary-question answers. It preserves durable operation IDs, crash-cut reconciliation, replay/snapshot recovery, cursor epochs, and per-request authorization checks.
- Toolbox, terminal, files, browser, extensions, model/provider settings, arbitrary tool invocation, sensitive approvals, raw Runtime/Pi RPC, hidden reasoning, unrestricted provider errors, and unknown host events have no wire command or projection escape hatch. Authorized read-only conversation projection may contain the tool name, arguments, textual output, and completion/error state already visible in the desktop transcript; it adds no executable command variant.
- Mobile maintains independent drafts/read markers/run state per session, never auto-sends an offline draft, connects only in the foreground, stops timers/sockets while suspended, and resumes through cursor/replay/snapshot/operation-status recovery.

The production closed-loop integration reports:

```text
node --import tsx scripts/remote-control-direct-closed-loop.integration.test.ts
PASS — 1/1 integration test covering catalog/history/create/send/stop/rename/pin/archive, recovery, and revoke.
```

## T037–T050 — Profiles, endpoint maintenance, and central-topology removal

**Status**: PASS

- A phone can store multiple independent computer profiles and one to eight explicitly approved endpoints per profile. Endpoints support add, edit, test, prioritize, and remove; the final endpoint cannot be removed without removing the profile.
- Add/edit performs a non-mutating challenge probe against the exact candidate address and verifies the stored machine ID, desktop key ID, fingerprint, endpoint, protocol version, and challenge freshness before SQLite mutation. A DHCP/DNS reassignment or substituted identity leaves the profile unchanged and causes zero session reads/mutations.
- Endpoint preference changes only reorder approved values. Successful fallback promotes the reachable approved address; no public address, discovered address, redirect, scheme/path/query injection, or unapproved DNS target becomes trusted.
- Removing a profile disconnects its active transport, removes its SQLite projection and pending state, and deletes only that computer's SecureStore keys. Revoking a phone closes only its active sockets and leaves unrelated computers/phones usable.
- The old Relay app/server/provider/migrations and root Relay scripts were removed. Mobile auth-session/web-browser/notification dependencies, plugins, code, tests, translations, login UI, and push state were removed with pnpm lockfile reconciliation.
- Boundary/privacy checks make account/OIDC/token, Relay/PostgreSQL/push, excluded capabilities, deep imports, cycles, public endpoint literals, and secret/challenge/ciphertext diagnostic output machine-rejected.
- Package owner READMEs and desktop/mobile `en-US`/`zh-CN` catalogs describe the direct architecture and pass exact key/interpolation parity.

The two-computer/two-phone production-profile integration reports:

```text
node --import tsx scripts/remote-control-direct-profiles.integration.test.ts
PASS — 1/1 integration test covering LAN/Tailscale fallback, same-identity DHCP edit, identity mismatch with zero mutation, revoke isolation, and disable.
```

## T051 — Final focused non-UI suites

**Status**: PASS

Final rerun on 2026-09-14:

| Owner / command                                               | Result                                                                                 |
| ------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `pnpm --filter @workbench/remote-control-contracts test`      | PASS — 37/37                                                                           |
| `pnpm --filter @workbench/remote-control-client test`         | PASS — 18/18; 200 sessions/10,000 events in about 212 ms, 101,911 retained UTF-8 bytes |
| `pnpm --filter @workbench/remote-control-direct-server test`  | PASS — 16/16                                                                           |
| `pnpm --filter @workbench/pi-runtime-remote-control test`     | PASS — 28/28                                                                           |
| `pnpm --filter @workbench/mobile test`                        | PASS — 42/42, including native network/permission and catalog no-churn coverage        |
| `pnpm --filter @workbench/desktop-electron test`              | PASS — 154; SKIP — 5 Windows-only; FAIL — 0; 159 total                                 |
| `pnpm --filter @workbench/ui-settings-general test`           | PASS — 2/2                                                                             |
| Direct pairing, closed-loop, and profiles integration scripts | PASS — 3/3                                                                             |
| Boundary/privacy test scripts                                 | PASS — 9/9                                                                             |
| `node scripts/check-remote-control-boundaries.mjs`            | PASS                                                                                   |

No UI/DOM/Hook render suite, Browser interaction, Electron UI smoke, or mobile UI smoke was added or run.

## T052 — Expo and Android production evidence

**Status**: PASS for locally executable build gates

```text
pnpm install --frozen-lockfile
PASS — 106 workspace projects; lockfile already up to date with pnpm 11.22.0.

pnpm mobile:expo-check
PASS — dependencies are up to date.

pnpm mobile:doctor
PASS — 21/21 checks.

mobile package resolution
PASS — React 19.2.3; React Native 0.86.3; one mobile-resolved copy of each.

pnpm mobile:export:production
PASS — production Hermes bundles exported for Android and iOS.

pnpm mobile:android-release
PASS — local release-variant APK compiled with the generated development/debug signing configuration; no production signing or external service was used.
```

Android artifact:

- Path: `apps/mobile/android/app/build/outputs/apk/release/app-release.apk`
- Size: `176296785` bytes.
- SHA-256: `b4e3e1f9cf1f91a2651c060eccb1a77d2ad6432ede86d8aadc47ea4a109a155f`.
- The APK contains `libQuickCrypto.so` and `libNitroModules.so` for `arm64-v8a`, `armeabi-v7a`, `x86`, and `x86_64`.
- The generated and merged release manifests contain `android:usesCleartextTraffic="true"`; their permission set includes camera and internet but not audio recording. Cleartext transport is required only because authentication and application-content encryption are implemented by the pinned direct HPKE protocol rather than Web PKI.
- Expo config introspection proves that iOS contains `NSLocalNetworkUsageDescription`, `NSAllowsLocalNetworking=true`, and one narrow insecure-load exception for `ts.net` plus subdomains. It contains no microphone or Face ID usage description. This follows Apple's ATS requirement for local IP/unqualified-name loads while supporting explicitly approved Tailscale MagicDNS `.ts.net` names.
- A `strings` scan of `assets/index.android.bundle` found the required direct HPKE auth domain, both direction labels, and `workbench.remote.direct-pairing-transcript`.
- The same scan found no exact account/OAuth/OIDC/auth-session/notification/Relay/token/provider field, no legacy pairing transcript, and no test pairing/private-key marker. A raw cross-binary substring is not treated as an exact symbol; the exact-word scan is the recorded security check.
- No EAS build, signing service, store submission, upload, or deployment was run.

## T053 — Electron packaged-artifact evidence

**Status**: PASS for artifact-only packaging

```text
pnpm --filter @workbench/desktop-electron run pack:artifact
PASS — Linux unpacked Electron artifact composed from 1,965 renderer static files and the target-specific Runtime artifact.
```

The packaged `resources/app/electron/desktop-remote-control.cjs` contains the direct pairing and direct crypto entries, address policy, authentication/gateway, Pi direct/frame processors, projection/recovery, operation ledger, and SQLite ledger. `direct-remote-listener.cjs` contains the complete `ws` 8.21.3 implementation and fixed direct listener adapter. The packaged modules contain no unresolved `@workbench/*` imports. The Runtime artifact remains separately curated and loopback-only.

Installed-application execution and Electron/UI smoke are explicitly unexecuted under the no-UI-smoke constraint; this task validates the packaged artifact graph, not OS installation behavior.

## T054 — Full repository gates

**Status**: PASS with one verified unrelated formatting baseline failure

| Command                             | Result                                                                                                  |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `pnpm check:workspace-dependencies` | PASS                                                                                                    |
| `pnpm check:package-structure`      | PASS — 100 libraries, 584 test files, 0 tracked migration violations                                    |
| `pnpm typecheck`                    | PASS — 5 apps and 100 library packages                                                                  |
| `pnpm build`                        | PASS — Runtime, Web, static desktop renderer, Electron-target Runtime, and desktop artifact composition |
| `git diff --check`                  | PASS                                                                                                    |
| `pnpm lint`                         | Oxlint PASS; final format stage reports the unrelated file below                                        |
| `pnpm format`                       | Reports the same unrelated file below                                                                   |

The only repository-wide format issue is `packages/client/ui-message-actions/package.json`, where an existing/user-owned change adds `@workbench/ui-conversation-nodes`. That file is outside the mobile-remote-control feature and was already part of unrelated UI refactoring work; it was inspected to identify the exact diff and intentionally not modified. Targeted formatting and `git diff --check` pass for the Spec 014 implementation files. There is no unexplained deterministic failure in the feature scope.

## T055 — Final artifact consistency and requirement map

**Status**: PASS for implementation consistency

Speckit cross-artifact analysis compared `spec.md`, `plan.md`, `research.md`, `data-model.md`, both files in `contracts/`, `quickstart.md`, `tasks.md`, the constitution, and the actual package/app graph. Coverage is 39/39 numbered requirements/outcomes and 62/62 tasks. No critical or high inconsistency remains. Actual task paths were reconciled for the final direct-pairing, authentication, Pi frame, endpoint-maintenance, and read-only transcript files.

### Functional requirements

| Requirement | Implementation evidence                                                                                                    | Status |
| ----------- | -------------------------------------------------------------------------------------------------------------------------- | ------ |
| FR-001      | Account-free mobile boot/profile model; auth-session/OIDC/token paths removed and scanned                                  | PASS   |
| FR-002      | Encrypted desktop configuration defaults to disabled; listener lifecycle test proves no listener before explicit enable    | PASS   |
| FR-003      | Desktop port and exact eligible interface selector; bounded IPC displays active addresses                                  | PASS   |
| FR-004      | Dedicated fixed-path gateway; Runtime stays loopback-only; boundary/package scans reject raw RPC exposure                  | PASS   |
| FR-005      | Two-minute, single-use QR invitation with one-time bootstrap secret only                                                   | PASS   |
| FR-006      | Manual host/IP, port, and one-time-code flow uses the same pairing service                                                 | PASS   |
| FR-007      | Canonical transcript binds identities, exact endpoint, keys, version, expiry; desktop safety confirmation required         | PASS   |
| FR-008      | Attempt/frame/byte/time/connection bounds, five-attempt lock, expiry/deny/use/restart invalidation, atomic reuse tests     | PASS   |
| FR-009      | Per-computer phone P-256/HPKE identities and independently revocable desktop authorizations                                | PASS   |
| FR-010      | Fresh signed challenge plus machine/device/revision/scope/revocation checks before every frame/effect                      | PASS   |
| FR-011      | Pairing bootstrap HPKE Base and business HPKE Auth; pinned identity mismatch fails before data/effect                      | PASS   |
| FR-012      | SQLite stores multiple verified computer profiles and explicit LAN/Tailscale endpoints; keys remain in SecureStore         | PASS   |
| FR-013      | Endpoint add/edit/test/prioritize/remove with verify-before-persist identity probe                                         | PASS   |
| FR-014      | Approved-list-only dialing and terminal identity mismatch; new identity requires pairing                                   | PASS   |
| FR-015      | Closed catalog/history/create/send/stop/rename/pin/unpin/archive surface and production integration                        | PASS   |
| FR-016      | Pi/desktop remains sole executor and source of authoritative session/order/run/organization/result state                   | PASS   |
| FR-017      | Bounded pages/events, cursor/replay/snapshot, durable idempotency/result recovery, local drafts, stale/offline state       | PASS   |
| FR-018      | AppState/network lifecycle closes and suppresses work in background, reconnects/resynchronizes on foreground               | PASS   |
| FR-019      | Endpoint grammar is limited to directly reachable private LAN/Tailscale forms; no discovery/NAT/port-forward/Relay         | PASS   |
| FR-020      | Tailscale is ordinary address reachability only; no SDK, API, auth key, credential, or control-plane dependency            | PASS   |
| FR-021      | Desktop lists phone name/state/last activity and provides local immediate revoke                                           | PASS   |
| FR-022      | Revocation closes affected sockets and preserves unrelated devices/profiles; integration coverage                          | PASS   |
| FR-023      | Closed codecs/projections/boundary tests reject every excluded capability and raw Runtime/Pi escape hatch                  | PASS   |
| FR-024      | Mobile and desktop `en-US`/`zh-CN` parity plus static accessibility review; user content/stable IDs are preserved          | PASS   |
| FR-025      | Relay app/server/database/push removed; production integrations run with no central service                                | PASS   |
| FR-026      | Notification/push dependency and UI removed; foreground synchronization is the explicit product behavior                   | PASS   |
| FR-027      | Closed projection preserves all visible assistant text, tool calls/JSON arguments, textual results, status, and truncation | PASS   |
| FR-028      | Transcript data uses authenticated HPKE business frames/cache protections and adds no invocation/approval/raw-RPC path     | PASS   |

### Success criteria

| Criterion | Automated/static evidence                                                                                           | Release evidence status                                                |
| --------- | ------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| SC-001    | Complete QR pairing path, desktop approval, and session-open states exist and pass the direct integration           | Physical first-user two-minute/90% study unexecuted                    |
| SC-002    | Complete manual host/port/code path passes the direct integration                                                   | Physical three-minute comprehension study unexecuted                   |
| SC-003    | Catalog/history loopback and 200-session reducer profile pass                                                       | Real LAN/Tailscale p95 two-second measurement unexecuted               |
| SC-004    | All accepted mutation paths and authoritative convergence pass the closed loop                                      | Real LAN/Tailscale p95 two-second measurement unexecuted               |
| SC-005    | Cursor/snapshot/status recovery and crash-cut at-most-once suites pass                                              | Real network restoration five-second measurement unexecuted            |
| SC-006    | Different identity produces zero reads and zero mutations in client/integration tests                               | PASS deterministically; real DHCP/DNS scenario remains a physical gate |
| SC-007    | Revoke closes active target sockets and preserves unrelated device in tests                                         | PASS deterministically; real-device five-second measurement unexecuted |
| SC-008    | Closed protocol/projection plus boundary/privacy suites report no excluded route                                    | PASS — deterministic code boundary                                     |
| SC-009    | Pairing/closed-loop/profile integration starts no account, Relay, database, provider, or push service               | PASS — deterministic topology                                          |
| SC-010    | Both locale parity suites pass; static screen review covers accessible labels/live state and preserves content/IDs  | PASS statically; assistive-technology review unexecuted                |
| SC-011    | Projection fixtures prove exact normal text/arguments/output, safe multi-byte truncation, and hidden-data exclusion | PASS — deterministic projection boundary                               |

### Explicitly unexecuted physical and release gates

These do not block implementation completion, but they do block a claim of production release readiness:

- QR/manual comprehension and the SC-001/SC-002 time targets on real iOS and Android devices.
- Native RFC 9180 interoperability on actual iOS and Android hardware, including device-only key storage after reinstall/restore behavior.
- iOS local-network permission prompt and an iOS archive/build on macOS/Xcode; this Linux host cannot produce that evidence.
- Android installation and lifecycle coverage on physical hardware. The local release APK was installed and launched on the API 36 `WorkbenchRemoteApi36` emulator for the reported Hermes crash path, but this does not replace real-device validation.
- Linux, macOS, and Windows firewall prompts, exact selected-interface exposure, packaged installation, launch, upgrade, and uninstall behavior.
- Real Wi-Fi/Ethernet transitions, IPv4/IPv6 LAN routing, DHCP changes, address disappearance, and OS sleep/wake.
- Real Tailscale IPv4, IPv6, single-label MagicDNS, `.ts.net`, ACL-denied, disconnected, reconnect, and tailnet transition scenarios.
- Background/suspension/termination and foreground recovery under actual iOS/Android lifecycle limits.
- VoiceOver/TalkBack, large Dynamic Type, touch-target, light/dark theme, desktop density/radius, and bilingual human localization review.
- SC-003/SC-004 p95 latency, SC-005/SC-007 wall-clock convergence, mobile memory, render responsiveness, battery, and long-duration soak measurements on reference hardware.
- Independent cryptographic/protocol/security review, penetration testing, release signing, EAS/store builds, notarization, store submission, deployment, and artifact upload.

## Post-implementation desktop development startup regression

**Status**: FIXED and verified

The Electron development process initially loaded the direct remote-control bridge without a TypeScript ESM loader. Native Electron Node therefore rejected extensionless relative imports inside workspace TypeScript sources, beginning with `remote-control-contracts/lib/bounds`, even though the same graph passed under the repository TypeScript test runner and after production esbuild bundling.

`createElectronLaunchConfiguration` now resolves the Desktop app's pinned `tsx` loader and appends its file URL to the development child's `NODE_OPTIONS`. Existing caller-provided Node options remain intact, all `WORKBENCH_*` values are still scrubbed before the one trusted renderer origin is injected, and packaged Electron builds remain independent of `tsx`.

```text
node --test scripts/electron-dev-orchestrator.test.mjs
PASS — 4/4, including loader registration and inherited NODE_OPTIONS coverage.

pnpm --filter @workbench/desktop-electron test
PASS — 157 passed, 5 platform-specific tests skipped.

pnpm --filter @workbench/desktop-electron typecheck
PASS

ELECTRON_RUN_AS_NODE=1 NODE_OPTIONS='--import=tsx' electron <direct bridge import probe>
PASS — all seven direct bridge public entries loaded in Electron Node 24.18.1.

pnpm check:workspace-dependencies
PASS

pnpm check:package-structure
PASS — 100 libraries, 584 test files, 0 tracked migration violations.

pnpm --filter @workbench/desktop-electron run pack:artifact
PASS — development-only loader injection did not affect the packaged artifact graph or budget.
```

The host's `libEGL`/NVIDIA DRI warning is independent of this module-resolution failure; it can affect GPU acceleration but did not participate in loading the desktop remote-control bridge.

### Linux secure-storage startup containment

**Status**: FIXED and verified

On the KDE development host, Electron's automatic password-store selection chose `basic_text`, which the remote-control store correctly rejects because it cannot protect the desktop pairing private key. The host already runs GNOME Keyring with the Secret Service component. Electron's main-process probe with `--password-store=gnome-libsecret` reported `isEncryptionAvailable=true` and selected `gnome_libsecret`.

Before Electron becomes ready, Desktop now selects `gnome-libsecret` on Linux unless the caller already supplied an explicit password-store switch. The encrypted store still rejects `basic_text`; no plaintext or application-managed fallback key was added. Remote bridge creation/start failures are contained in a `failed` lifecycle state, cleaned up, and reported without becoming fatal to the main Workbench Runtime or renderer.

The Desktop suite includes deterministic coverage for selecting Secret Service exactly once, preserving an explicit backend, rejecting unsafe storage, cleaning a partially started bridge, and keeping the optional remote capability isolated. The updated artifact-only package build and remote-control boundary scan pass.

### Mobile session-catalog loading loop

**Status**: FIXED and verified

The session catalog screen previously depended on the complete machine object and on a provider callback that was recreated whenever the machine catalog changed. Every successful remote catalog read then unconditionally replaced that machine with a new `online` object and timestamp. This formed a React dependency loop: loading, catalog render, online projection update, and loading again.

The machine-online projection is now idempotent and returns the existing snapshot when the target is already online and the catalog is current. Protocol compatibility reads through a stable provider callback backed by the latest catalog snapshot, so machine presence updates no longer recreate session-catalog or conversation controllers. The catalog screen depends only on the stable machine identifier and its availability rather than object identity.

```text
pnpm --filter @workbench/mobile typecheck
PASS

pnpm --filter @workbench/mobile test
PASS — 42/42, including no-churn online catalog regression coverage.

pnpm --filter @workbench/mobile export:production
PASS — production Hermes bundles exported for Android and iOS.

pnpm --filter @workbench/mobile android:release
PASS — refreshed local release-variant APK built successfully after the loading-loop fix.

pnpm check:remote-control-boundaries
PASS
```

## T056–T062 — Complete visible AI messages, raw tool transcripts, and reference mobile UI

**Status**: PASS for all deterministic implementation gates

- The closed conversation union now carries optional tool calls on assistant messages and ordered read-only tool-result items. Tool names, canonical JSON arguments, textual output, success/failure, and truncation state are preserved; there is still no inbound tool command, approval, terminal, file, browser, extension, model-setting, or raw-RPC operation.
- The Pi 0.85.1 projection uses only the installed SDK's public message shapes. It emits every user-visible assistant text part, tool-call arguments, tool-result text, and bash command/output. Thinking/reasoning, binary/image blocks, result `details`, provider exception text, approvals, and unknown host events remain excluded.
- Ordinary content inside its field limit is unchanged. Assistant text is capped at 96 KiB, aggregate arguments at 64 KiB, and each textual result at 128 KiB; UTF-8 code-point truncation cannot produce malformed Unicode and is surfaced explicitly in both locales.
- The supplied mobile references informed a restrained, monochrome session catalog and conversation layout with floating headers, machine pills, pinned/recent groups, flat assistant messages, a compact bottom composer, and default-expanded selectable tool transcripts. All interactive elements inspected in the new surface are at least 48 points high, use safe-area/keyboard handling, semantic light/dark palettes, and localized accessibility labels.
- Legacy `content-available-on-desktop` frames remain decodeable only for cached/wire compatibility; the current Pi projection never emits them and the mobile conversation renders no desktop-only placeholder.
- Raw transcript content travels inside the already authenticated HPKE business envelope and is cached as conversation content. Privacy checks still reject it from diagnostic/log output. A paired phone must therefore be treated as an authorized viewer of potentially sensitive project content and revoked when no longer trusted.

Focused verification rerun on 2026-09-14:

| Owner / command                                             | Result                                                                 |
| ----------------------------------------------------------- | ---------------------------------------------------------------------- |
| Contract typecheck and tests                                | PASS — 37/37, including strict transcript bounds/unknown-field cases   |
| Pi remote projection typecheck and tests                    | PASS — 29/29, including exact raw output and multi-byte truncation     |
| Remote client typecheck and tests                           | PASS — 19/19, including streamed text bounds and retained tool calls   |
| Mobile typecheck and tests                                  | PASS — 42/42, including locale parity and cached transcript round-trip |
| `node --test scripts/remote-control-privacy-audit.test.mjs` | PASS — 5/5                                                             |
| `pnpm check:remote-control-boundaries`                      | PASS                                                                   |
| Direct closed-loop production integration                   | PASS — 1/1                                                             |
| `pnpm check:workspace-dependencies`                         | PASS                                                                   |
| `pnpm check:package-structure`                              | PASS — 100 libraries, 584 test files, 0 tracked migration violations   |
| Targeted `oxfmt --check`                                    | PASS — 148 files                                                       |
| `git diff --check`                                          | PASS                                                                   |
| Expo dependency check                                       | PASS                                                                   |
| Expo Doctor                                                 | PASS — 21/21                                                           |
| Android/iOS production Hermes export                        | PASS                                                                   |
| Android local release compile                               | PASS — 670 tasks; 642 executed, 28 up-to-date                          |

The final local Android release APK is `apps/mobile/android/app/build/outputs/apk/release/app-release.apk`, `176296785` bytes, SHA-256 `b4e3e1f9cf1f91a2651c060eccb1a77d2ad6432ede86d8aadc47ea4a109a155f`. No UI/DOM/Hook test, Browser interaction, physical-device run, production signing, upload, or deployment was performed. Targeted emulator reproduction checks for reported defects are recorded below; the previously listed physical-device, accessibility, real-network, performance, and independent security gates remain open.

## Post-implementation pairing terminal recovery

**Status**: FIXED and statically verified

A manual emulator attempt used a code from an earlier invitation while Desktop displayed a different current invitation. The screenshot also exposed a recovery defect: after an invitation reached `consumed`, `denied`, `expired`, `locked`, or `cancelled`, Desktop kept the obsolete QR/code card mounted. Its only visible cancel action could itself fail because a terminal invitation is no longer cancellable, leaving no usable create-new-request action.

`RemoteDeviceSettingsItem` now clears terminal pairing state and QR data as soon as the state is observed, reloads devices after `consumed`, and returns the settings surface to its create-pairing action for every failed terminal state or polling failure. It also handles an already-terminal state immediately after a hot reload. Pairing lifetime, one-time-code validation, cryptography, and the two-minute expiry remain unchanged.

```text
pnpm --filter @workbench/ui-settings-general typecheck
PASS

pnpm --filter @workbench/ui-settings-general test
PASS — 2/2

pnpm exec oxlint packages/client/ui-settings-general/src/remote-device-settings-item.tsx
PASS

pnpm exec oxfmt --check packages/client/ui-settings-general/src/remote-device-settings-item.tsx
PASS

git diff --check -- packages/client/ui-settings-general/src/remote-device-settings-item.tsx
PASS
```

No UI/DOM/Hook test or UI interaction smoke was added or run.

## Post-implementation Hermes relative-time crash

**Status**: FIXED and verified on the Android release emulator

The paired mobile app reached `SessionCatalogScreen` and then terminated with `TypeError: undefined cannot be used as a constructor`. Android recorded a JavaScript exception and an app-crash exit. The component stack and JavaScript stack both resolved the fault to the shared relative-time formatter: the Expo SDK 57/Hermes release runtime on the emulator did not provide `Intl.RelativeTimeFormat`, while the session catalog constructed it to render timestamps such as “15 minutes ago”. Pairing, direct LAN transport, secure storage, and the session service had already succeeded and were not the source of this crash.

The shared i18n runtime now uses native `Intl.RelativeTimeFormat` when the host provides it and otherwise applies a bounded `en-US`/`zh-CN` fallback for year, quarter, month, week, day, hour, minute, and second units. The fallback preserves automatic forms such as `now`, `yesterday`, `tomorrow`, `现在`, `昨天`, and `明天`, plus numeric past/future forms. Web and Electron retain their native formatter path.

```text
pnpm --filter @workbench/i18n typecheck
PASS

pnpm --filter @workbench/i18n test
PASS — 9/9, including a host with Intl.RelativeTimeFormat removed.

pnpm --filter @workbench/mobile typecheck
PASS

pnpm --filter @workbench/mobile test
PASS — 42/42

pnpm --filter @workbench/mobile export:production
PASS — Android and iOS production Hermes bundles exported.

pnpm --filter @workbench/mobile android:release
PASS — BUILD SUCCESSFUL; 670 tasks, 642 executed and 28 up-to-date.

adb install -r apps/mobile/android/app/build/outputs/apk/release/app-release.apk
PASS — existing paired application data preserved.
```

The refreshed APK launched cold on the API 36 `WorkbenchRemoteApi36` emulator. The paired `Pi Workbench` computer was connected, its session catalog rendered real pinned/recent sessions and the fallback relative timestamp `10 minutes ago`, and it remained present after an additional 30-second observation. The process kept PID `2844`, `MainActivity` remained the top resumed activity, and filtered `AndroidRuntime`, `ReactNativeJS`, `libc`, and `DEBUG` fatal logs were empty. This was a targeted reproduction/verification of the reported crash, not a substitute for the still-open physical-device, lifecycle, accessibility, performance, or real-network release gates.

## Post-implementation session-catalog rail layout

**Status**: FIXED and verified on the Android release emulator

React Native 0.86 gives both vertical and horizontal `ScrollView` base styles `flexGrow: 1`. The session catalog's horizontal machine rail did not override that default, so it competed with the actual session scroller for the page's remaining vertical space. Its 52-point pill stayed at the top of the expanded rail and the unused part appeared as a large blank region before the `Sessions` heading.

The outer horizontal rail now sets `flexGrow: 0`; its existing content padding and machine-pill height determine its natural height, while the session scroller remains the only element that expands. No fixed screen-height spacer or device-specific dimension was introduced.

```text
pnpm --filter @workbench/mobile typecheck
PASS

pnpm --filter @workbench/mobile test
PASS — 42/42

pnpm exec oxlint apps/mobile/src/app/machines/[machineId]/sessions/index.tsx
PASS

pnpm exec oxfmt --check apps/mobile/src/app/machines/[machineId]/sessions/index.tsx
PASS

Android incremental release assemble
PASS — BUILD SUCCESSFUL; 670 tasks, 90 executed and 580 up-to-date.

adb install -r apps/mobile/android/app/build/outputs/apk/release/app-release.apk
PASS — existing pairing and application data preserved.
```

On the API 36 emulator, `Pi Workbench` remained connected and the `Sessions` heading rendered at vertical bounds `[53,546][317,634]`, directly below the machine rail instead of in the lower half of the screen. Pinned and recent rows remained scrollable above the bottom search/create dock. The application kept PID `3069`, `MainActivity` remained top-resumed, and the filtered fatal log was empty. This targeted visual verification used the `ui-styling` guidance to keep the fix local to the owning rail rather than introducing a global or fixed-height workaround.

## Final conclusion

All 62 implementation tasks are complete, all feature-scope deterministic tests/typechecks/builds/package/boundary checks pass, and every FR is backed by code plus automated or static evidence. The direct topology is account-free at the Workbench layer and uses only explicitly approved LAN/Tailscale reachability. A paired phone can read every user-visible assistant message and bounded raw textual tool transcript without receiving a tool-execution surface. Release readiness remains conditional on the explicitly listed physical-device, operating-system, performance/usability, and independent security gates.
