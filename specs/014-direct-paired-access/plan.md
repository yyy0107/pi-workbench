# Implementation Plan: Direct Paired Mobile Access

**Branch**: `014-direct-paired-access` | **Date**: 2026-09-13 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/014-direct-paired-access/spec.md`

## Summary

Replace the account/OIDC/central-Relay topology introduced by Spec 013 with a direct, account-free connection between the Expo mobile app and a dedicated network gateway in Electron main. The gateway is disabled by default, binds only explicitly selected LAN or Tailscale interface addresses, authenticates independently paired phone keys, and exposes only the existing bounded multi-session projection and command allowlist. QR pairing carries the direct endpoints and verified desktop key; manual pairing accepts host/IP, port, and a one-time code with a mandatory safety-code confirmation. Existing HPKE, strict codecs, projection sanitizers, operation ledger, cursor replay, snapshots, mobile SQLite cache, and Pi public-RPC adapter are retained. The conversation projection carries every user-visible assistant text message plus read-only tool-call arguments and original textual tool output, but it still has no tool invocation/approval or raw RPC entry. The central Relay app, PostgreSQL/OIDC/push providers, account credentials, and background-notification promise are removed from the first-release product graph.

## Technical Context

**Language/Version**: TypeScript 7 for repository libraries and desktop-facing contracts, TypeScript 6 for the Expo app, existing Electron CommonJS composition where already established, Node.js 24 runtime

**Primary Dependencies**: Expo SDK 57, Expo Router, React Native 0.86, `expo-camera`, `expo-secure-store`, `expo-sqlite`, `react-native-quick-crypto`, Node `http`/`os`/`crypto`, `ws` 8.21, existing public `@workbench/pi-rpc-client/api` and Runtime transport client APIs

**Storage**: Mobile SQLite for bounded connection/session projections, drafts, cursors, and pending operations; mobile SecureStore for phone private keys and paired-device authorization; Electron `safeStorage` document for the desktop installation key, direct-listener configuration, and paired-phone public authorizations; existing desktop SQLite operation ledger for idempotent remote mutations

**Testing**: Existing Node test runner through package-local `pnpm ... test`, TypeScript tests via `scripts/run-typescript-tests.mjs`, direct loopback WebSocket integration tests, boundary/privacy scripts, package structure/dependency checks, typecheck, lint/format, Expo Doctor/export, Android release compile, Electron artifact packaging; no UI/DOM/Hook render tests or UI interaction smoke

**Target Platform**: Workbench Electron desktop on supported Linux/macOS/Windows hosts; Workbench Remote on iOS and Android; direct reachability through RFC1918/ULA local networks or Tailscale IP/MagicDNS paths

**Project Type**: Existing monorepo with one mobile app, one desktop app, reusable protocol/client/direct-server/Pi bridge packages, and no deployed remote-control backend in the target architecture

**Performance Goals**: Pairing completes within two minutes by QR or three minutes manually; healthy direct session/history and mutation results become current within two seconds; reconnect convergence within five seconds; 200-session projection remains responsive under the existing one-second reducer budget

**Constraints**: No account login or account identifier; no central Relay/PostgreSQL/push service; no public discovery/NAT traversal/port-forwarding guidance; direct gateway disabled by default; never expose the Runtime listener; all application business frames encrypted and bounded; endpoint identity pinned; active-foreground mobile socket only; strict Toolbox/terminal/file/browser/extension/model/provider/tool/approval exclusion

**Scale/Scope**: Several paired computers per phone, several independently revocable phones per computer, up to 200 retained session summaries per computer, bounded conversation pages and replay ring, one active direct listener generation per selected desktop interface set

## Constitution Check

_Pre-design gate: PASS. Post-design gate: PASS._

| Principle                                     | Result | Evidence                                                                                                                                                                                                                                                                                                    |
| --------------------------------------------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| I. Domain-owned capabilities                  | Pass   | The embedded network gateway replaces the old Relay server package as `packages/server/remote-control-direct-server`; mobile, desktop composition, contracts, transport client, and Pi bridge retain distinct owners. The central Relay app is removed rather than retained as a hidden product dependency. |
| II. Shallow source and explicit interfaces    | Pass   | The renamed direct-server package keeps real TypeScript capability code in `src/`, internal address/rate/bounds helpers in `lib/`, explicit exports, package-root tests, and no deep imports. Existing Electron CJS composition remains CJS and is bundled into the artifact.                               |
| III. Shared foundations and ownership         | Pass   | Remote code calls only the existing public Pi client API through the current Runtime connection. Desktop settings use the existing settings contribution and shared controls/tokens. Mobile retains its app-local native UI and the single shared i18n runtime.                                             |
| IV. Incremental behavior-compatible migration | Pass   | Business command/projection, HPKE, operation ledger, replay/snapshot, persisted drafts, and stable session behavior are migrated before old account/Relay code is removed. The unreleased Spec 013 wire format is replaced with a clearly distinct direct-pairing/authentication contract.                  |
| V. Validate before completion                 | Pass   | TDD contract/direct-gateway/client tests precede implementation; each phase records evidence; final checks include the formal direct closed loop, dependency/privacy scans, builds, and explicit physical-device gates.                                                                                     |

No constitution exception is required.

## Architecture

```text
┌──────────────────────────── Workbench Remote (Expo) ────────────────────────────┐
│ Connection profiles · QR/manual pairing · SecureStore keys · SQLite projection │
│                    active-only direct WebSocket client                         │
└───────────────────────────────┬─────────────────────────────────────────────────┘
                                │ ws://address:port/remote/v1/direct
                                │ every pairing/business payload HPKE protected
                                │ phone challenge proof + pinned desktop identity
                                ▼
┌──────────────────────── Electron main: Direct Remote Gateway ──────────────────┐
│ exact selected-interface listeners · pre-auth budgets · pairing · device auth  │
│ encrypted frame processor · cursor/snapshot · SQLite operation ledger          │
└───────────────────────────────┬─────────────────────────────────────────────────┘
                                │ existing authenticated loopback RuntimeConnection
                                │ public @workbench/pi-rpc-client/api only
                                ▼
┌──────────────────────────── Pi Runtime Host ────────────────────────────────────┐
│ authoritative sessions · conversation journal · execution · workspace ordering │
│ remains loopback-only; no direct network listener or raw RPC forwarding        │
└─────────────────────────────────────────────────────────────────────────────────┘
```

Tailscale is not an application integration. Its IP address or MagicDNS name is merely a user-approved direct endpoint. Workbench does not call a Tailscale API, inspect the tailnet, request an auth key, or manage VPN state.

## Security and Transport Decisions

1. **Dedicated listener, never Runtime exposure**: Electron main owns one gateway generation tied to the current Runtime connection. Node `http.Server` instances bind exact selected interface addresses and share a `ws` `noServer` upgrade handler. No HTTP business routes, local Runtime token, unrestricted RPC, or renderer credential crosses the gateway.
2. **Disabled by default**: No listener starts until the local desktop user enables remote access and selects eligible interface addresses and a port. Configuration errors and port conflicts fail closed and are reported through the desktop settings contract.
3. **Private/Tailscale endpoint policy**: Enumerate non-internal unicast interfaces with `os.networkInterfaces()`. Eligible literals are RFC1918 IPv4, CGNAT/Tailscale IPv4 (`100.64.0.0/10`), and IPv6 ULA. Manual hostnames are limited to single-label local/Tailscale-resolved names, `.local`, and `.ts.net`; arbitrary public URL schemes, credentials, paths, query strings, fragments, wildcard addresses, multicast, and link-local endpoints are rejected.
4. **Application-layer encryption over direct WebSocket**: Direct v1 uses `ws://` because local IP addresses normally lack CA-valid certificates and Expo's standard WebSocket does not provide portable self-signed certificate pinning. Every pairing claim, authorization result, command, response, event, and snapshot containing application data is HPKE-encrypted and authenticates its bounded header as associated data. Tailscale independently encrypts its network path. Android release manifests enable cleartext only for this application through `expo-build-properties`; iOS declares local-network usage, `NSAllowsLocalNetworking`, and a narrow insecure-load exception for `ts.net` subdomains. The application still accepts only the explicit private/Tailscale endpoint grammar. A future `wss://` mode may be additive but is not required here.
5. **QR bootstrap**: QR contains the exact candidate endpoints, invitation ID/secret, desktop encryption key and fingerprint, protocol range, and expiry. It contains no reusable device authorization. The phone encrypts its claim to the QR-pinned desktop key.
6. **Manual bootstrap**: The phone connects to the entered host/port, obtains only a bounded public pairing hello, encrypts its claim to the offered desktop key, and proves the one-time code. A potential key substitution necessarily changes the transcript-derived safety code; authorization is not created until the local desktop user compares and confirms the phone's code. Invitations expire after two minutes, allow at most five failed claims, and are atomically single-use.
7. **Post-pair authentication**: On each connection, the gateway sends a fresh nonce. The phone signs a canonical transcript containing machine ID, phone ID, nonce, selected protocol, endpoint identity, and cursor/operation recovery summary. The gateway verifies the stored public key and authorization revision before accepting sealed business frames. No bearer, refresh token, ticket endpoint, shared password, or credential appears in the URL.
8. **Identity pinning and endpoint edits**: A connection profile may contain several explicitly approved endpoints, but all must prove the same stored desktop key fingerprint. An identity mismatch blocks data and mutations and can be resolved only by new pairing.
9. **No central notifications**: The app closes its socket while inactive/background and resynchronizes in foreground. Relay-backed push registration, notification intent publication, and completion-notification claims are removed from the first-release graph.

## Migration Map

| Existing Spec 013 surface                                                   | Direct-access target                                                               | Action                                                                                                                          |
| --------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `apps/mobile/src/features/auth.ts` and OAuth landing                        | Account-free installation identity and connection profiles                         | Delete OAuth controller/UI; boot directly to local profile state.                                                               |
| Build-time OIDC and Relay origins                                           | User-scanned or user-entered endpoints                                             | Replace with no required remote env configuration.                                                                              |
| Relay HTTP pairing claim                                                    | Direct encrypted WebSocket pairing frames                                          | Rewrite mobile pairing adapter and desktop pairing owner.                                                                       |
| Relay socket ticket/proof                                                   | Direct nonce challenge and paired-device signature                                 | Replace transport handshake; retain active-only reconnect/recovery semantics.                                                   |
| `apps/remote-control-relay`                                                 | No deployed app                                                                    | Remove app, root scripts, migration/build configuration, and integration ownership.                                             |
| `@workbench/remote-control-relay-server`                                    | `@workbench/remote-control-direct-server`                                          | Rename owner and replace account/DB/push/router services with embedded gateway/pairing/address/auth services.                   |
| Account/machine/device authorization                                        | Installation/machine/device authorization                                          | Remove `accountId`; persist phone authorization locally on the desktop.                                                         |
| Relay sealed envelope routing metadata                                      | Direct endpoint sealed frame                                                       | Remove source/target routing principal metadata not needed by one desktop connection; retain machine/device/key/expiry binding. |
| Relay notification service and Expo push adapters                           | Foreground synchronization only                                                    | Remove notification product code/dependencies and stale claims.                                                                 |
| Existing HPKE, command union, projection, operation ledger, cursor/snapshot | Same direct trust boundary                                                         | Retain and adapt identifiers/authorization checks.                                                                              |
| Desktop outbound Relay connection                                           | Inbound direct gateway generation                                                  | Replace with selected-interface listeners tied to Electron/Runtime lifecycle.                                                   |
| Existing remote-device settings item                                        | Direct access toggle, interface/port config, QR/safety confirmation, paired phones | Extend the same settings contribution and IPC contract using shared controls/tokens.                                            |

## Project Structure

### Documentation (this feature)

```text
specs/014-direct-paired-access/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── validation.md
├── checklists/
│   └── requirements.md
└── contracts/
    ├── direct-control-protocol.md
    ├── desktop-direct-gateway.md
    └── mobile-direct-client.md
```

### Source Code (repository root)

```text
apps/mobile/
├── app.config.ts
├── package.json
├── src/app/                         # account-free landing, pairing, sessions
├── src/features/                    # direct pairing, profiles, sessions
├── src/platform/                    # SecureStore, SQLite, AppState, network
├── src/state/                       # direct transport and bounded projections
└── tests/                           # pure logic/native crypto/direct adapters

apps/desktop-electron/
├── src/desktop-remote-control.cjs   # direct gateway generation composition
├── src/desktop-services.cjs         # safeStorage direct config/keys/authorizations
├── src/desktop-renderer-protocol.cjs
├── src/main.cjs
├── src/preload.cjs
└── test/                            # lifecycle, IPC, packaging

packages/contracts/remote-control-contracts/
├── src/                             # direct pairing/auth/business protocol
├── lib/                             # canonicalization and bounds
└── tests/

packages/transport/remote-control-client/
├── src/                             # direct connection/profile/recovery state
├── lib/                             # endpoint/backoff/page helpers
└── tests/

packages/server/remote-control-direct-server/
├── src/                             # address policy, gateway, pairing, device auth
├── lib/                             # rate, bounds, redaction, canonical helpers
└── tests/

packages/pi-runtime/pi-runtime-remote-control/
├── src/                             # command adapter, projection, frame processor, ledger
├── lib/                             # closed command/sanitizer/event helpers
└── tests/

packages/client/ui-settings-general/
├── src/remote-device-settings-item.tsx
└── src/i18n/{en-US,zh-CN}.ts

scripts/
├── check-remote-control-boundaries.mjs
├── remote-control-direct-closed-loop.integration.test.ts
└── remote-control-privacy-audit.test.mjs
```

**Structure Decision**: Preserve the existing mobile, protocol, client, Pi bridge, and desktop settings owners. Replace the deployable Relay owner with one embedded direct-server capability package and compose its concrete network listeners only in Electron main. This keeps network parsing/authentication independent of Pi while avoiding a third runtime product that the selected scope does not need.

## Delivery Phases

1. Freeze Spec 013 as superseded architecture evidence and establish direct-access contracts, endpoint policy, and account-free persisted entities.
2. TDD the direct protocol, pairing/authentication state machines, address policy, and connection profiles.
3. Implement the embedded direct-server package and locally persisted phone authorizations.
4. Replace Electron's outbound Relay bridge with exact-interface direct listeners while retaining the current Runtime/Pi command/projection composition.
5. Replace mobile auth/Relay bootstrap with account-free profile boot, QR/manual direct pairing, direct challenge authentication, and existing recovery.
6. Replace desktop settings IPC/UI with enable/interface/port/pairing/device controls and remove account/Relay/push product dependencies.
7. Remove the Relay app/package identity, OIDC/PostgreSQL/push code and scripts, then enforce zero-account/zero-Relay product boundaries.
8. Run formal direct closed-loop, privacy/security, mobile/desktop packaging, full repository gates, and document physical-device LAN/Tailscale release checks.

## Complexity Tracking

No constitution violation requires justification. A dedicated direct-server package remains necessary because untrusted network ingress, pairing/rate limits, and device authentication must not be implemented inside the Pi bridge or React UI. It replaces rather than adds to the previous Relay server owner.

## Workbench 项目约定

遵循 `.specify/memory/constitution.md`：库包根 `packages/<领域>/<能力>`，src 为真实能力实现/契约/装配，lib 为内部辅助源码，两处均最多一级子目录；src 不得全为转导出。能力与辅助源码均保留 TS/TSX，不改写为 JS，tests/ 为库包测试目录；使用 pnpm。能力迁移任务必须包含前置任务、来源/目标、消费者、验证与完成条件；只在验证后勾选。
