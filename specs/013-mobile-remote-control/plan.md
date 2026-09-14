# Implementation Plan: Workbench Mobile Remote Control

> **Superseded topology notice (2026-09-13)**: This account/OIDC/central-Relay plan remains historical evidence for the implementation it produced. [Spec 014](../014-direct-paired-access/plan.md) replaces its identity and network topology with account-free direct LAN/Tailscale pairing while retaining the bounded multi-session, encryption, idempotency, projection, and recovery work.

**Branch**: `013-mobile-remote-control` (logical Speckit feature; planning worktree remains on `codex/package-refactor`) | **Date**: 2026-09-13 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/013-mobile-remote-control/spec.md`

## Summary

Build a focused Workbench phone companion that remotely manages and follows desktop-hosted sessions. The selected mobile stack is Expo SDK 57 with React Native 0.86, React 19.2.3, Expo Router, Development Builds, SecureStore, SQLite, and `expo-notifications`. The phone never runs an agent and has no toolbox, terminal, file, browser, extension, automation, model/provider, or raw Runtime surface.

Both phone and Electron desktop establish outbound TLS connections to a new Remote Relay. The Relay owns account/device authorization, pairing metadata, presence leases, sealed-frame routing, rate limits, audit metadata, and push delivery; it does not own or persist Workbench conversation state. An Electron-main Remote Bridge connects through the existing loopback `RuntimeConnection` to the one installed Pi session owner, produces a bounded mobile-safe projection, enforces the closed remote-command allowlist, persists operation idempotency, and owns replay/snapshot continuity. Application-layer phone-to-desktop E2EE is required before session content ships and is guarded by a blocking Node/Expo RFC 9180 interoperability and security spike.

## Technical Context

**Language/Version**: Existing Node/library packages use repository TypeScript 7.0.2 and the current Node/Electron toolchain; `apps/mobile` uses the Expo SDK 57-supported app-local TypeScript 6.x, React 19.2.3, and React Native 0.86. All new ability/utility source remains TS/TSX; existing Electron CJS composition stays in its current language.

**Primary Dependencies**: Expo SDK 57, Expo Router, React Native 0.86, `expo-secure-store`, `expo-sqlite`, `expo-notifications`, Expo Development Builds/CNG; existing public `@workbench/pi-rpc-client` and Runtime transport client APIs inside Electron main; Node HTTP/WebSocket service primitives for Relay; OIDC/OAuth Authorization Code + PKCE identity integration; RFC 9180 HPKE implementation selected only after the mandatory compatibility/security gate.

**Storage**: PostgreSQL 16+ for Relay account-scoped pairing/device/revocation/push/audit metadata; no durable Relay session transcript. Desktop bridge uses a mode-0600 Node SQLite operation ledger and bounded local projection/replay state, with private keys/credentials protected through Electron `safeStorage`. Mobile uses SecureStore for small credentials/key material and SQLite/WAL for a bounded disposable projection, cursor, drafts/read state, and unresolved operation records.

**Testing**: Node test runner/TypeScript test harness already used by the repository; strict contract, reducer/state machine, Relay integration, bridge integration, persistence/crash-recovery, crypto-vector/interoperability, privacy/budget, dependency, typecheck, package-structure, lint/format, Expo Doctor/export, Android release compile, EAS preview build, and existing desktop build checks. Per repository instruction, no new or executed UI/DOM/Hook render tests or UI interaction smoke tests.

**Target Platform**: Android 7+ and iOS 16.4+ mobile clients; current Electron desktop platforms; deployable Linux Node Relay behind TLS termination with PostgreSQL; iOS artifacts built on macOS/Xcode or EAS because the current host is Linux.

**Project Type**: pnpm TypeScript monorepo with a native mobile application, an Internet-facing Relay service, reusable contract/client/server libraries, and Electron-main desktop integration.

**Performance Goals**: Under normal connectivity, p95 usable session list/conversation open and accepted mutation visibility within two seconds; authoritative convergence within five seconds after reconnect; no duplicate accepted business effect in forced retry/crash validation; smooth bounded handling of at least 200 session summaries with no interaction pause above one second on the reference device; desktop replay covers up to 10,000 events/10 MiB/15 minutes.

**Constraints**: Desktop is the only session/run authority; desktop local Runtime remains loopback-only; Relay cannot become a transcript store; no credential in URLs/logs/renderer; closed mobile command and content projection; offline mutations are never silently queued; WSS operates only while the app is active; push is advisory; all text/result/frame limits are UTF-8 byte based; protocol errors are bounded and redacted; `en-US` and `zh-CN` are mandatory; pnpm only; all new library packages obey shallow `src`/`lib` structure and acyclic public exports.

**Scale/Scope**: First release for individual accounts with multiple phones/computers, a validation profile of at least 200 visible sessions per machine, pages of at most 100 summaries or 50 conversation items, 10,000 retained events, and recent 10,000 completed operations per desktop. Relay is horizontally shardable by account/machine and its deployment load target is established from production sizing rather than encoded as a protocol limit.

## Constitution Check

_Gate evaluated before Phase 0 research and re-evaluated after Phase 1 design._

| Principle/gate                             | Pre-research status | Post-design evidence                                                                                                                                                                                                                                                             |
| ------------------------------------------ | ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| I. Concrete capability packages            | Pass                | New libraries each have one named capability under `packages/<domain>/<capability>`; product compositions remain under `apps/*`. No domain aggregator or nested workspace package is introduced.                                                                                 |
| II. Shallow source and explicit interfaces | Pass                | Every planned library has real TS implementations in both `src/` and `lib/`, maximum one nested source directory, explicit exports, package-root tests, and no deep imports. Electron's existing CJS composition is edited in place rather than mechanically converted.          |
| III. Shared foundations and ownership      | Pass                | Dependency order is contracts → transport/server capability → app composition. Mobile reuses the single i18n runtime. Electron main reaches the existing installed Pi owner through public clients and never creates a second registry/facade.                                   |
| IV. Incremental compatibility              | Pass                | Local Runtime connection union/token, Pi RPC, session persistence, stable IDs, Web/Desktop behavior, and existing build are not repurposed. Remote protocol is additive, versioned, and disabled without configuration.                                                          |
| V. Validate before completion              | Pass                | Each non-UI package has focused tests; final checks cover structure/dependencies/types/builds and regression. The repository's explicit no-UI-test rule is preserved and all real-device behaviors are reported as unexecuted release gates rather than falsely marked complete. |
| pnpm, TS/TSX, bilingual copy               | Pass                | Commands and scripts use pnpm; new source is TS/TSX except existing CJS owners; all new visible strings and notification copy have `en-US`/`zh-CN` parity.                                                                                                                       |
| No publish/upload without request          | Pass                | Plan covers local/CI builds and preview artifacts only; it does not publish an app, deploy Relay, upload a release, or change an external service.                                                                                                                               |

There are no constitution violations requiring an exception. The feature adds multiple apps/packages because they correspond to three distinct runtime/trust owners—phone, Relay, and desktop—and preserve the required dependency direction.

## Architecture

```text
apps/mobile
  Expo routes + platform adapters
      │
      ├── HTTPS: sign-in, pairing, device metadata, one-use socket ticket
      ├── foreground WSS: sealed commands/results/events/snapshots
      └── APNs/FCM: opaque synchronization hints
      ▼
apps/remote-control-relay
  @workbench/remote-control-relay-server
  identity + pairing + authorization + fenced presence + routing + push
  PostgreSQL contains security/routing metadata, never Workbench transcript
      ▲
      │ outbound WSS with a separate machine credential
      │
apps/desktop-electron (main process)
  @workbench/pi-runtime-remote-control
  E2EE + allowlist + projection + operation ledger + cursor/replay/snapshot
      │ existing loopback RuntimeConnection; credentials stay in main
      ▼
existing runtime-node / installed Pi session and workspace owners
```

Security and state are checked at each boundary:

1. Identity provider authenticates account principals.
2. Relay binds account, device, machine, authorization scopes, revocation, ticket, and active lease generation.
3. Desktop bridge authenticates the paired device's E2EE sender key, expiry, command type, scope, operation identity, and entity/interaction revision.
4. Existing local Pi/session/workspace owners remain authoritative for domain validity and persisted state.
5. Mobile treats only a contiguous desktop-authenticated projection as current.

## Project Structure

### Documentation (this feature)

```text
specs/013-mobile-remote-control/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── checklists/
│   └── requirements.md
├── contracts/
│   ├── desktop-bridge.md
│   ├── mobile-client.md
│   └── remote-control-protocol.md
└── tasks.md                         # Generated later by /speckit-tasks; not created here
```

### Source Code (repository root)

```text
apps/
├── desktop-electron/
│   ├── src/                         # Existing main lifecycle; compose/dispose bridge
│   └── test/                        # Existing non-UI lifecycle/security tests
├── mobile/
│   ├── app.config.ts
│   ├── eas.json
│   ├── package.json
│   ├── src/
│   │   ├── app/                     # Expo Router layouts and screens
│   │   ├── components/              # Native mobile-only presentation
│   │   ├── features/                # Pairing, machines, sessions, conversation
│   │   ├── i18n/                    # Bundle, en-US, zh-CN
│   │   ├── platform/                # Expo storage/lifecycle/notification adapters
│   │   └── state/                   # App composition around pure client package
│   └── tests/                       # Pure non-render logic/config tests only
└── remote-control-relay/
    ├── package.json
    ├── src/
    │   ├── configuration.ts
    │   ├── main.ts
    │   ├── migrations/
    │   └── providers/               # OIDC, PostgreSQL, push, listener adapters
    └── tests/                        # Composition/config/migration tests

packages/
├── client/
│   ├── i18n/                        # Broaden React 19.2 peer; retain single runtime
│   ├── ui-remote-conversation/      # Restricted desktop-presentation reuse for Expo DOM
│   └── ui-settings-general/          # Pairing/device administration UI + both locales
├── contracts/
│   └── remote-control-contracts/
│       ├── src/                     # Public DTOs, version/types, parser entry points
│       ├── lib/                     # Canonical encoding, byte/depth/ID helpers
│       ├── tests/
│       ├── README.md
│       └── README.zh-CN.md
├── pi-runtime/
│   └── pi-runtime-remote-control/
│       ├── src/                     # Bridge, projection, command adapter, ports
│       ├── lib/                     # Ledger/replay/backoff/crypto framing helpers
│       ├── tests/
│       ├── README.md
│       └── README.zh-CN.md
├── server/
│   └── remote-control-relay-server/
│       ├── src/                     # Pairing/device/ticket/lease/router/push services
│       ├── lib/                     # Rate/budget/redaction/expiry helpers
│       ├── tests/
│       ├── README.md
│       └── README.zh-CN.md
└── transport/
    └── remote-control-client/
        ├── src/                     # Client, reducer, sync, operations, public ports
        ├── lib/                     # Backoff, bounded queue, cursor helpers
        ├── tests/
        ├── README.md
        └── README.zh-CN.md
```

**Structure Decision**: Keep native navigation, lifecycle, connection state, questions, and composer code app-local. Reuse desktop conversation presentation through one isolated Expo DOM component owned by `ui-remote-conversation`; this boundary accepts only the closed remote projection and has no Shell or Runtime connection. Protocol, state-machine transport, Relay domain, and Pi desktop bridge remain independently owned. Compose the bridge in Electron main—where the local Runtime connection and secure credential lifecycle already live—rather than changing `runtime-node` or constructing a second Pi service. Compose the Relay in its own deployable app so the server library stays storage/listener/provider independent.

## Package Ownership and Dependency Direction

| Owner                         | Responsibilities                                                                                        | May depend on                                                                                                        | Must not depend on                                                                                           |
| ----------------------------- | ------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `remote-control-contracts`    | Closed schemas, strict codecs, budgets, canonical encoding, cursor/errors                               | Core React-free contracts only                                                                                       | React, Node server, Pi RPC, Runtime transport, apps                                                          |
| `remote-control-client`       | Auth sequencing, WSS lifecycle, reducer, replay/snapshot, operation recovery                            | Remote contracts and structural ports                                                                                | Expo, React Native, SQLite, SecureStore, Pi/Desktop/UI packages                                              |
| `remote-control-relay-server` | Pairing, device authorization/revocation, WSS ticket, fenced leases, sealed routing, push intent, audit | Remote contracts and generic server foundations                                                                      | Pi, Electron, Workbench UI, local Runtime/session contracts                                                  |
| `pi-runtime-remote-control`   | Desktop E2EE, sanitized projection, allowlist adapter, ledger, cursor/replay/snapshot                   | Remote contracts; public Pi RPC/Runtime transport/conversation helpers where their graph remains server-safe         | Electron API, app source, private Pi registries/StreamHub, raw Runtime server internals                      |
| `apps/mobile`                 | Expo product, native adapters, routes/screens/i18n                                                      | Remote client/contracts, shared i18n runtime, the exact `ui-remote-conversation` DOM boundary, Expo/native libraries | Every other desktop UI package, Shell, agent Runtime client, Pi Runtime/client, Electron, extensions/toolbox |
| `ui-remote-conversation`      | Closed remote projection to shared desktop message/Markdown/tool presentation                           | Shared UI presentation primitives, remote contracts, shared i18n                                                     | Shell, Runtime connections, Pi RPC, native transport, routes, extensions/toolbox                             |
| `apps/remote-control-relay`   | Deployment configuration, listener, PostgreSQL migrations/adapter, OIDC and push provider               | Relay server/contracts                                                                                               | Pi/Desktop product packages                                                                                  |
| `apps/desktop-electron`       | Bridge lifecycle and injected safe storage/local Runtime connection                                     | Desktop bridge and existing desktop services                                                                         | Remote protocol exposure to renderer                                                                         |
| `ui-settings-general`         | Desktop user controls for pairing/revocation                                                            | Existing UI/services/local API                                                                                       | Machine credential/private keys, remote session payloads                                                     |

Production dependency cycles and deep imports are forbidden. Static checks explicitly reject accidental mobile imports of toolbox/extension/Runtime surfaces and accidental Relay imports of Pi.

## Data and Persistence Plan

### Relay PostgreSQL

Persist only account/machine/device authorization, pairing lifecycle, public-key fingerprints/public material, credential/token hashes or references, push registration, lease/audit metadata, and schema revisions. Transactional constraints enforce single invitation consumption and independent device revocation. Notification tokens are encrypted at rest. Security audit entries are content-free.

Do not create conversation, prompt, message, tool result, snapshot, or general event-history tables. Encrypted command data may exist only in bounded volatile delivery memory while a current desktop lease is online and before receipt/expiry.

### Desktop

Persist a mode-0600 SQLite operation ledger keyed by machine/device/operation and enough reconciliation identity to prevent duplicate effects across crashes. Keep session content in existing owners. Store Relay machine credential and private key with the existing Electron `safeStorage` fail-closed pattern, separate from renderer/sidecar/update credentials.

The desktop bridge owns an in-process mobile-safe projection and bounded event ring. A bridge/Runtime continuity loss starts a new epoch; the phone replaces state from snapshot. No change to current session persistence format is required except the verified authoritative `session.send` idempotency hook that records client operation/message identity before effect.

### Mobile

SecureStore holds only refresh credential, signing/E2EE key material or native key reference, and optional encrypted-database key. SQLite holds installation sentinel, machine/session projection, cursor, bounded/LRU history if enabled, drafts/read markers, operation recovery, and notification dedupe. Snapshot plus cursor commits atomically. Missing installation sentinel clears surviving iOS Keychain state; logout/unpair/revoke clears matching secure and cached data.

## Protocol and Security Plan

### Pairing

Desktop creates a two-minute, single-use invitation (five-minute hard maximum) with a 128-bit ID, at least 256-bit secret, desktop public-key fingerprint, and protocol version. Relay stores only verifier/public metadata. Phone authenticates in the system browser using Authorization Code + PKCE, creates independent signing/E2EE keys, and submits a transcript-bound claim. Phone and desktop display the same safety code; desktop confirms before invitation consumption and device authorization creation. QR and manual code share the same entropy/lifecycle.

### Socket authentication

Phone and desktop obtain short, single-use, proof-bound socket tickets over authenticated HTTPS. WSS has no credential query parameter. The first frame is limited to 16 KiB and five seconds; Relay acknowledges negotiated protocol and principal before any business frame. New desktop lease generations fence old connections.

### E2EE gate

TLS 1.3 is mandatory. Before session content ships, an RFC 9180 authenticated-HPKE implementation must pass Node↔Expo runtime interoperability, standard vectors, tamper/wrong-key/rotation tests, dependency/advisory review, and production build validation. `@hpke/core >=1.9.0` is a candidate, not a pre-approved selection. If the gate fails, implementation stops for an explicit security/product decision; no TLS-only fallback is automatic.

### Capability allowlist

Only list/read/create/send text/stop/rename/set pinned/archive and answer an existing ordinary question are modeled. Archive restore/delete and security-sensitive tool approvals remain desktop-only. No arbitrary method string exists. Relay and desktop both enforce authorization; desktop maps commands exhaustively and sanitizes local responses before encryption.

### Idempotency and conflicts

At-least-once delivery uses stable operation IDs and a durable desktop ledger for at-most-once effects. Same ID/same digest returns the original status; same ID/different digest conflicts. Organization mutations are set-to-value and use entity revisions. Ordinary question answers bind interaction revision/expiry. Text send must place client operation identity in the authoritative journal/mutation owner before prompt execution. Offline commands are rejected, and expired commands never execute later.

### Synchronization

Desktop projection cursor is `{epoch, offset-as-decimal-string}`. The phone applies only an exact-next event in the same epoch. Gaps, epoch changes, replay expiry, or snapshot-buffer overflow force a paged authoritative snapshot. Snapshot and cursor update transactionally on mobile. WSS closes/stops reconnecting while the app is not active; notification hints only set `needsSync`.

## Delivery Phases

### Phase A — Contracts and blocking crypto proof

1. Scaffold `remote-control-contracts` with strict public/inner schemas, canonical encoding, budgets, version negotiation, redacted errors, and forbidden-surface dependency checks.
2. Scaffold minimal Node and Expo development-build harnesses.
3. Complete and document the HPKE compatibility/security gate.
4. Do not proceed to user-content transport until the gate passes or the product explicitly changes the privacy requirement.

### Phase B — Client state and Relay

1. Implement the pure client lifecycle/reducer/operation model with injected platform ports.
2. Implement Relay pairing, device, revocation, ticket, lease, routing, audit, and push ports.
3. Compose PostgreSQL/OIDC/WSS/push providers in the Relay app.
4. Verify multi-tenant isolation, restart behavior, limits, redaction, and no session-content persistence.

### Phase C — Desktop bridge

1. Implement and test the sanitizer against hostile Pi payloads.
2. Implement operation ledger and crash reconciliation, resolving `session.send` authoritative identity before enabling send.
3. Implement local public Pi mapping, remote projection, cursor/event ring, and snapshot bootstrap.
4. Compose one bridge in Electron main and bind it to local Runtime start/restart/stop and secure credential storage.
5. Add desktop pairing/device settings via narrow local API and bilingual copy.

### Phase D — Mobile foundation and product

1. Scaffold Expo app with exact compatible versions, Router, Development Build, and CNG.
2. Add auth, pairing, storage, lifecycle, notification, and deep-link adapters.
3. Add shared i18n runtime support and app-local bilingual bundle; broaden shared React peer to `>=19.2.0 <20` and verify one React instance.
4. Implement machine/session list, bounded conversation, text composer, stop, create/rename/pin/archive, ordinary question, drafts/unread, and stale/reconnect states.
5. Keep all excluded route/component/command/dependency surfaces absent.

### Phase E — Integration and release readiness

1. Exercise pairing, revoke, presence, reconnect, Runtime restart, operation crash cuts, cursor fallback, push hints, and privacy budgets using non-UI harnesses.
2. Run affected and full static/type/package/build checks plus Expo export, Android release compile, EAS preview, Relay build, and packaged desktop build.
3. Measure success criteria with instrumented integration fixtures; record OS-imposed push delay separately.
4. Record all unexecuted real-device/UI gates without claiming verification.
5. Keep publishing, production deployment, and store submission outside this feature unless separately authorized.

## Validation Strategy

### Focused automated checks

- Protocol strictness, version mismatch, command allowlist, error/budget validity, multibyte and depth limits.
- Pairing expiry/replay/race/account/transcript confirmation, credential audience/scope/rotation, ticket proof/replay, independent revocation.
- RFC HPKE vectors, Node↔Expo interoperability, wrong key, header/ciphertext/key-ID tampering, key rotation.
- Relay tenant/machine/device isolation, lease fencing, bounded volatile delivery, push receipt/token invalidation, audit/log redaction.
- Desktop mapping and sanitizer, operation crash cuts and send deduplication, revision conflicts, local Runtime generation replacement.
- Cursor duplicate/gap/epoch/replay/snapshot/overflow/backpressure and concurrent snapshot changes.
- Mobile reducer, reconnect/backoff, AppState policy, stale mutation gating, drafts/read/unread preservation, operation uncertainty, SQLite migration/transaction/retention, push dedupe.
- Static dependency graph guarantees no toolbox/terminal/file/browser/extensions/model settings/raw Runtime path.
- Bilingual key/interpolation parity and `en-US` fallback.

### Build/static checks

- Frozen pnpm installation; Expo dependency check and Doctor.
- Affected package/app typechecks and root typecheck.
- Repository lint, format, workspace dependency, and package-structure checks.
- Expo production export, Android release compile, EAS preview build, Relay production build, Electron build/package, and existing root build.

### Explicitly unexecuted device/UI gates

Repository instruction forbids adding/running UI/DOM/Hook tests and UI interaction smoke. Therefore QR/manual pairing comprehension, real AppState/network changes, Android Doze, iOS suspension/cold notification launch, SecureStore reinstall/key invalidation, accessibility, theme/safe-area/touch behavior, and reference-device latency remain release gates to be executed only by an authorized later release process. Static checks cannot close these gates.

## Key Risks and Mitigations

| Risk                                                        | Impact                                     | Mitigation/gate                                                                                 |
| ----------------------------------------------------------- | ------------------------------------------ | ----------------------------------------------------------------------------------------------- |
| No acceptable HPKE implementation in Expo runtime           | E2EE cannot ship                           | Blocking compatibility/security spike; no silent TLS-only downgrade                             |
| Prompt executes before durable remote identity is journaled | Duplicate model run after crash/retry      | Authoritative session-owner idempotency hook and crash-cut tests before enabling send           |
| Existing Pi projection leaks paths/tool data                | Source or credential disclosure            | New mobile-safe contract, deny-by-default sanitizer, hostile fixtures, privacy scans            |
| Relay evolves into session storage                          | Conflicting authority and retention burden | Schema/dependency tests; no transcript tables; desktop-owned snapshots/replay                   |
| Runtime restarts while remote socket survives               | Stale commands reach wrong generation      | Electron lifecycle disposal, fenced lease, new epoch, mandatory snapshot                        |
| Expo React differs from desktop React                       | Duplicate/incompatible React runtime       | App-local exact Expo versions, broaden shared i18n peer only, dependency-resolution check       |
| Mobile background socket is suspended                       | Missed live events                         | Stop background socket work, generic push hint, authoritative foreground resync                 |
| Push is duplicated/dropped/delayed                          | Incorrect or noisy state                   | Dedup/collapse; hints never mutate state; report OS delivery separately                         |
| Device revocation races active sockets                      | Continued access                           | Relay and desktop double-check, invalidate ticket/lease, connection close, one-minute SC target |
| UI behavior remains untested by policy                      | Release usability/accessibility risk       | Explicit unexecuted device gates and no false verification claims                               |

## Complexity Tracking

No constitution violation is accepted. The three runtime products and four capability packages reflect independently deployable/trusted owners, not arbitrary layering. Simpler alternatives—direct desktop exposure, full Runtime proxy, Relay transcript replica, or desktop React UI reuse—violate the security, ownership, or platform constraints documented in [research.md](./research.md).

## Planning Outputs

- Phase 0 research: [research.md](./research.md)
- Phase 1 entity/state design: [data-model.md](./data-model.md)
- Public wire contract: [contracts/remote-control-protocol.md](./contracts/remote-control-protocol.md)
- Desktop integration contract: [contracts/desktop-bridge.md](./contracts/desktop-bridge.md)
- Mobile boundary contract: [contracts/mobile-client.md](./contracts/mobile-client.md)
- Implementation/validation guide: [quickstart.md](./quickstart.md)
- Requirements-quality checklist: [checklists/requirements.md](./checklists/requirements.md)

`tasks.md` is intentionally not created by `speckit-plan`; run `speckit-tasks` after approving this plan.

The repository does not contain `.specify/scripts/bash/update-agent-context.sh`, so the Speckit context-update step was completed by appending a concise, explicitly “not implemented” Spec 013 note to the root `AGENTS.md`. No `.specify/extensions.yml` exists, so all configured pre/post hooks were correctly skipped.
