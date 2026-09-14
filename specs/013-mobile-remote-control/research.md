# Phase 0 Research: Workbench Mobile Remote Control

**Feature**: `013-mobile-remote-control`<br>
**Date**: 2026-09-13<br>
**Status**: Complete — no unresolved clarification remains

## Decision Summary

| Area                  | Decision                                                                                                                               |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Mobile framework      | Expo SDK 57, React Native 0.86, React 19.2.3, Expo Router, TypeScript using the Expo-supported app-local version                       |
| Native workflow       | Expo Development Build with Continuous Native Generation (CNG); generated `ios/` and `android/` projects are not committed by default  |
| Repository placement  | Product UI and mobile composition in `apps/mobile`; reusable protocol and non-React logic in shallow `packages/*` capability packages  |
| Remote topology       | Mobile and desktop both establish outbound TLS connections to a Remote Relay; desktop remains the sole session authority               |
| Foreground/background | HTTPS + WSS while active; APNs/FCM notification hints while suspended; every foreground resume performs authoritative synchronization  |
| Local persistence     | SecureStore for small device credentials and keys; SQLite for a bounded, disposable projection and per-session drafts/read state       |
| Authorization         | Per-device, independently revocable credentials plus a closed remote-command allowlist checked by Relay and desktop                    |
| Delivery semantics    | At-least-once transport with a durable desktop operation ledger producing at-most-once business effects                                |
| Synchronization       | Desktop-owned `{epoch, offset}` cursor, bounded replay ring, paged snapshot fallback, transactional mobile cache replacement           |
| Content privacy       | TLS 1.3 plus application-layer phone-to-desktop E2EE, subject to a blocking cross-runtime crypto compatibility and security gate       |
| Notifications         | `expo-notifications`; Expo Push Service for MVP, with an abstraction that can later send native APNs/FCM tokens directly               |
| Scope                 | Session list/history/create/send/stop/rename/pin/archive and ordinary input responses only; no toolbox or unrestricted Runtime surface |

## 1. Mobile Framework

### Decision

Create `apps/mobile` with Expo SDK 57, React Native 0.86, React 19.2.3, Expo Router, and the TypeScript version supported by the generated Expo template. Use `pnpm create expo-app` and `pnpm expo install` to resolve compatible patch versions at implementation time; React and React Native stay on Expo's exact compatible versions rather than broad caret ranges.

The app uses this minimal route model:

```text
apps/mobile/src/app/
├── _layout.tsx
├── index.tsx
├── pair.tsx
└── machines/[machineId]/
    ├── sessions/index.tsx
    └── sessions/[sessionId].tsx
```

The stable custom URL scheme is `workbench-remote`. Route parameters are opaque identifiers. Root layout performs authentication and paired-device checks; route normalization rejects malformed notification/deep-link input but is not an authorization layer.

### Rationale

- Expo SDK 57 is the current stable Expo line and pairs React Native 0.86 with React 19.2.3. The bare React Native stable line is newer, but mixing it into the stable Expo SDK would create an unsupported dependency set.
- Expo provides the required routing, notification, SecureStore, SQLite, development-build, native-generation, and cloud-build paths with less custom native plumbing than a bare React Native app.
- Expo Router gives file-based native routes and deep-link integration for a small, stable set of screens without maintaining a second manual route table.
- The phone is a focused companion, so app-local React Native presentation is safer than importing the existing DOM/Lexical/Electron UI packages.

### Repository Compatibility

- `pnpm-workspace.yaml` already includes `apps/*`; no workspace-glob change is required.
- Keep pnpm isolated dependency installation. Expo SDK 52+ automatically configures Metro for monorepos when `expo/metro-config` is used, and SDK 54+ supports pnpm isolated installs. Do not add manual `watchFolders`, `resolver.nodeModulesPaths`, or `extraNodeModules` unless a demonstrated package-resolution failure requires it.
- `apps/web` currently uses React `^19.2.8` and TypeScript `^7.0.2`; the mobile app must retain its own Expo-compatible React and TypeScript versions. Do not downgrade the desktop/web toolchain.
- Do not import `@workbench/agent-runtime-client` or existing desktop UI packages into the mobile app because they carry browser/DOM assumptions and incompatible React peers. Reuse only explicit React-free contracts and newly defined mobile transport logic.
- Root `test:apps` and `typecheck:apps` automatically include app scripts. Mobile release/export commands remain separate from the existing desktop-focused root `build` until the product release pipeline intentionally includes them.

### Alternatives Rejected

- **Bare React Native 0.87**: gives maximum native control but adds avoidable platform maintenance and would not use Expo's current stable dependency set.
- **Flutter**: technically viable but would introduce Dart, a second package ecosystem, and duplicate the repository's TypeScript domain contracts.
- **Capacitor/PWA wrapper**: poorer fit for reliable SecureStore, notification, deep-link, and native lifecycle behavior.
- **Responsive reuse of the desktop React UI**: desktop components depend on DOM, Electron, Lexical, Shell portals, and desktop-only capabilities. It would make the forbidden toolbox surface structurally reachable.

### Sources

- [Expo latest SDK](https://docs.expo.dev/versions/latest/)
- [Expo SDK 57 release notes](https://expo.dev/changelog/sdk-57)
- [Expo default template](https://github.com/expo/expo/blob/main/templates/expo-template-default/package.json)
- [React Native releases](https://reactnative.dev/releases/overview)
- [Expo monorepo guide](https://docs.expo.dev/guides/monorepos/)
- [Expo Router navigation](https://docs.expo.dev/router/basics/navigation/)
- [Expo native-intent handling](https://docs.expo.dev/router/advanced/native-intent/)

## 2. Native Development and Distribution

### Decision

Use Expo Development Builds from the first implementation slice and configure native behavior through CNG/app config. Expo Go is not a supported development or release target. Generated native projects remain disposable unless a later native requirement cannot be represented by config plugins.

Android development/release compilation can run locally after the Android toolchain is configured. iOS compilation requires macOS/Xcode or EAS Build; the current Linux host cannot locally prove the iOS binary.

### Rationale

- Android remote push is unavailable in Expo Go for recent SDKs.
- SecureStore options and SQLite encryption/native configuration require development builds.
- CNG keeps native configuration declarative and avoids maintaining generated platform files before custom native code exists.

### Sources

- [Development builds introduction](https://docs.expo.dev/develop/development-builds/introduction/)
- [Using development builds](https://docs.expo.dev/develop/development-builds/use-development-builds/)
- [Expo CLI and platform build constraints](https://docs.expo.dev/more/expo-cli/)

## 3. Product and Package Boundaries

### Decision

Use four explicit boundaries:

1. `apps/mobile` owns Expo routes, mobile screens, mobile state composition, app-local i18n bundles, platform adapters, and release configuration.
2. `packages/contracts/remote-control-contracts` owns the versioned, closed schemas for public relay metadata and encrypted mobile–desktop plaintext. It contains no React, Node, Pi, or transport dependency.
3. `packages/transport/remote-control-client` owns the environment-neutral HTTPS/WSS client state machine, cursor recovery, bounded parsing, and connection ports used by mobile and contract tests.
4. `packages/server/remote-control-relay-server` owns Relay routing/device services. `packages/pi-runtime/pi-runtime-remote-control` owns the desktop projection, allowlist, operation ledger, and adapter to the public Pi RPC client. It is composed in the Electron main process after that process receives the current local `RuntimeConnection`; Relay is exposed through a new `apps/remote-control-relay` service entry point.

Desktop pairing and revocation UI extends the existing general settings capability and calls local services through the existing client API boundary. It does not embed Relay credentials or direct remote session payloads in the renderer.

Every new library package follows the constitution: package root `packages/<domain>/<capability>`, real code in both `src/` and `lib/`, no source nesting deeper than one subdirectory, explicit exports, TS/TSX, independent English and Chinese README, and tests at package root.

### Rationale

- The public remote protocol has a different trust boundary and smaller surface than local `@workbench/runtime-contracts` and Pi RPC.
- Keeping React Native UI in the only consuming app avoids a premature cross-platform UI package and React peer conflicts.
- A dedicated Pi desktop adapter can exhaustively translate approved remote commands through public Pi RPC client APIs without creating a second session registry or importing private server owners.
- A dedicated Relay entry point keeps a remotely reachable service out of the local Runtime listener and makes deployment/scaling choices explicit.
- Electron main already owns the in-memory sidecar connection, Runtime restart lifecycle, and encrypted credential storage. Starting/stopping the bridge there keeps the local Runtime loopback-only and reuses the one installed Pi server instance.

### Alternatives Rejected

- **Add `remote` to the current local Runtime connection union**: local renderer credentials and broad Runtime capabilities have the wrong scope and lifecycle for an Internet-facing device.
- **Proxy current Pi RPC through Relay**: current contracts include attachments, files, tools, host events, settings, and `unknown` payloads that violate the product boundary.
- **Put reusable mobile state in existing desktop client packages**: those packages assume DOM/React versions and would make mobile depend on unrelated desktop UI.
- **Put all Relay and desktop bridge code in apps**: it would hide reusable contracts/state machines and weaken package ownership and focused testing.
- **Install a second Pi session service for remote control**: violates the single registry/facade lifecycle and risks divergent sessions after restart or HMR.

## 4. Remote Topology and Source of Truth

### Decision

Both phone and desktop create outbound TLS connections to a deployable Remote Relay. The Relay authenticates principals, manages device/pairing metadata, issues single-use socket tickets, routes sealed frames, manages desktop presence leases, rate-limits clients, and sends push hints. The Electron-main Remote Bridge owns the authoritative remote projection, the operation ledger, and a bounded replay ring. It uses the existing loopback `RuntimeConnection`, public Runtime fetch/WebSocket factories, public Pi RPC client APIs, and the current Pi stream generation to reach the already-installed session owner.

The Relay does not persist unrestricted conversation history, tool output, snapshots, or a parallel session state. It may transiently buffer an encrypted in-flight command only while a valid desktop lease exists and only until desktop receipt or command expiry.

### Rationale

- Outbound desktop connectivity avoids exposing a local Runtime port through NAT/firewalls.
- One authoritative desktop owner avoids multi-master conflict resolution and keeps local Workbench behavior compatible.
- Relay presence and push are necessary for mobile networks and suspended apps, but they need not become a second session database.

### Alternatives Rejected

- **Direct phone-to-desktop Internet socket**: unacceptable NAT, certificate, exposure, and background-notification behavior.
- **Relay-hosted session replica**: creates a second source of truth and expands retention/privacy obligations.
- **CRDT/multi-master state**: unnecessary because the desktop is the sole mutation owner; revisions and preconditions solve multi-phone conflicts.

### Existing Workbench Integration Points

- Do not add a public `remote` variant to `@workbench/runtime-contracts`; its `desktop-sidecar` token remains an in-memory local bootstrap credential.
- Reuse `createRuntimeFetch`/the public Runtime WebSocket factory inside Electron main. Credentials remain in the main process and never enter Relay, phone, renderer, URL, argv, or environment variables.
- Use public `@workbench/pi-rpc-client/api` functions for list, create, history, rename, prompt, cancel, workspace pin, and archive. Use `PiConnectionController` for local host/mux generation and gap behavior where applicable.
- `session.send` constructs the existing Pi prompt as a single text block only. It never accepts the broader attachment/file/image/composer-command payload from mobile.
- Session creation accepts an already-visible opaque `workspaceId` or desktop default; it never accepts `cwd` or an arbitrary path.
- Desktop projection may reuse public Pi conversation projection helpers internally, but `apps/mobile` cannot depend on `@workbench/pi-conversation-adapter` because its current graph reaches the React/browser client.
- Runtime restart destroys the old bridge connection, starts a new bridge with the new local `RuntimeConnection`, changes the remote epoch, and forces a snapshot. The bridge package imports no Electron API; lifecycle and secure credential ports are injected by `apps/desktop-electron`.

## 5. Pairing, Identity, and Credentials

### Decision

Desktop initiates pairing with a short-lived, single-use QR challenge and a manual-code equivalent. The phone authenticates with the system browser using OAuth Authorization Code with PKCE, generates device-bound signing and E2EE key pairs, and claims the challenge. Both devices show a safety code derived from the full transcript. Desktop must explicitly confirm the phone before Relay atomically consumes the invitation and creates the paired-device authorization.

Pairing defaults:

- 128-bit random `pairingId`.
- At least 256-bit random `pairingSecret`; Relay stores only verification material.
- Two-minute expiry, never longer than five minutes.
- Transcript binds account, machine, desktop key, mobile signing key, mobile encryption key, protocol version, and expiry.
- Reuse, race, account mismatch, expiry, transcript change, denial, or safety-code mismatch fails closed.

Credentials are separated by purpose:

- Short-lived account access token for HTTPS, with refresh rotation or equivalent replay handling.
- Per-desktop machine credential for the outbound Relay lease.
- Per-phone, per-machine authorization with closed action scopes.
- Independent mobile signing/DPoP key and E2EE key.
- Existing desktop-renderer/sidecar bootstrap credentials are never copied to mobile or Relay.

Phone obtains a roughly 30-second, single-use WSS ticket over authenticated HTTPS. The first socket frame arrives within five seconds and binds the ticket, protocol version, and proof. No bearer credential appears in a URL, query string, analytics field, or crash report.

### Rationale

QR images can be copied or relayed. Short expiry, single use, account binding, proof of possession, visible safety code, and desktop confirmation address different portions of that risk. A QR secret alone is not a durable credential.

### Sources

- [RFC 10027: Cross-Device Flows security guidance](https://www.rfc-editor.org/info/rfc10027/)
- [RFC 8252: OAuth 2.0 for Native Apps](https://www.rfc-editor.org/rfc/rfc8252.html)
- [RFC 7636: PKCE](https://www.rfc-editor.org/info/rfc7636/)
- [RFC 9700: OAuth 2.0 Security Best Current Practice](https://www.rfc-editor.org/info/rfc9700/)
- [RFC 9449: DPoP](https://www.rfc-editor.org/info/rfc9449/)

## 6. Application-Layer Encryption

### Decision

Require TLS 1.3 for all network connections and design v1 envelopes for phone-to-desktop application-layer E2EE. Relay-visible routing headers are authenticated as associated data. Use RFC 9180 HPKE authenticated mode with a standard suite such as P-256/HKDF-SHA256/AES-256-GCM; do not invent a handshake, cipher, nonce scheme, or key format.

This is a blocking implementation gate, not an unverified library commitment. Before user-visible session content is enabled, a security spike must prove all of the following:

1. A maintained implementation works in Node and the selected Expo/React Native runtime without insecure WebCrypto polyfills.
2. Node-to-phone and phone-to-Node test vectors interoperate in both directions.
3. The selected implementation passes RFC 9180 vectors, mutation/tamper tests, dependency review, key lifecycle review, and the repository's supply-chain policy.
4. Known vulnerable versions are excluded. `@hpke/core` is only a candidate and must be at least 1.9.0 if selected; versions affected by nonce-reuse advisory GHSA-73g8-5h73-26h4 are forbidden.

If no acceptable implementation passes the gate, implementation stops for a product/security decision. It must not silently downgrade to TLS-only. A TLS-only internal prototype is possible only after explicit acceptance that the Relay can read prompts, code, conversation output, and ordinary interaction answers.

### Rationale

Workbench conversations can contain source code, prompts, and proprietary results. TLS protects each hop, but without application-layer encryption the Relay can read this data. Authenticated HPKE can prevent Relay plaintext access and undetected payload modification while retaining Relay routing.

E2EE does not protect availability, traffic metadata, a compromised endpoint, or content intentionally displayed on a paired device. Relay can still delay, drop, or reorder traffic; cursors, expiries, and operation identities detect or bound the result.

### Alternatives Rejected

- **Custom cryptography**: unacceptable correctness and review risk.
- **TLS-only as silent fallback**: changes the privacy boundary without user consent.
- **Signal-style ratchet in v1**: adds post-compromise and forward-secrecy machinery beyond this focused first release; it can be a versioned protocol evolution.

### Sources

- [RFC 9180: Hybrid Public Key Encryption](https://www.rfc-editor.org/info/rfc9180/)
- [RFC 8446: TLS 1.3](https://www.rfc-editor.org/info/rfc8446/)
- [hpke-js repository](https://github.com/dajiaji/hpke-js)
- [hpke-js nonce-reuse advisory](https://github.com/dajiaji/hpke-js/security/advisories/GHSA-73g8-5h73-26h4)

## 7. Closed Remote Capability Surface

### Decision

Define a closed, versioned command union. No contract accepts `{method: string, payload: unknown}` and no fallback forwards a string to Runtime or Pi RPC.

Allowed actions are:

- `sessions.read`
- `sessions.create`
- `sessions.send`
- `sessions.stop`
- `sessions.organize`
- `interactions.respond`

Allowed mutations are create session, send text, stop, rename, set pinned, set archived, and respond to an already-published ordinary question. `workspaceId`, when supported, must be selected from a bounded visible projection; the phone cannot submit a path or `cwd`.

Explicitly unreachable from the protocol:

- session deletion and archive restoration;
- terminal, files, editor, diff/review, browser, Git operations;
- arbitrary tool invocation, raw tool arguments/results, model reasoning, or interactive tool cards;
- attachments, images, local files, arbitrary composer commands;
- extensions/plugins/toolbox/automation management;
- model, provider, authentication, or general desktop settings;
- raw Runtime/Pi methods, host events, or unknown payloads;
- security-sensitive tool permission approval. Those prompts remain desktop-only in v1.

Relay checks token scope and machine binding. Desktop repeats device/revocation/action checks and performs an exhaustive command switch. UI omission is not considered an authorization control.

### Rationale

This enforces the requested “multi-session remote control only” boundary at compile-time schemas, runtime parsing, authorization, and adapter ownership.

## 8. Operation Delivery and Idempotency

### Decision

Use at-least-once network delivery. Every mutation has a stable 128-bit `operationId`, `issuedAt`, and `expiresAt`. Desktop persists intent before invoking the domain operation and records a bounded terminal result. Ledger key is `(machineId, deviceId, operationId)` and includes a canonical command SHA-256 digest.

- Same identity and same digest returns the original status/result.
- Same identity and a different digest returns `operation_id_conflict` without execution.
- Mobile retries an uncertain result using the original identity or queries status; it never creates a new identity for the same user intent.
- Completed entries remain for at least seven days and the most recent 10,000 operations. Incomplete entries cannot be evicted only because a size limit was reached.
- `session.create` allocates a stable session ID with the accepted intent.
- Rename, pin, archive, and stop use set-to-value/idempotent semantics and optional entity revision preconditions.
- Ordinary interaction answers bind the published interaction identity, revision, and expiry.
- `session.send` must persist `operationId`/`clientMessageId` in the authoritative session journal before execution. Existing `rpcId` behavior is not assumed sufficient until verified.

Default command expiry is 30 seconds for stop, two minutes for send/create, five minutes for organization, and no later than the interaction expiry for an answer. If no valid desktop lease exists, Relay returns `machine_offline`; it does not hold a command for unexpected later execution. Offline UI keeps draft text and requires explicit retry.

### Rationale

Network loss after a side effect but before acknowledgement makes transport-level exactly-once impossible. A durable intent/result ledger plus domain reconciliation gives the required at-most-once effect and recoverable outcome.

## 9. Cursor, Replay, Snapshot, and Backpressure

### Decision

Remote projection uses `{epoch: string, offset: decimal uint64 string}`. Epoch changes whenever the desktop bridge loses projection continuity. Offset increases strictly within one epoch and is never represented as a JSON number.

Desktop maintains an atomic mobile-safe projection and a replay ring capped by the first reached limit: 10,000 events, 10 MiB, or 15 minutes. A snapshot captures `baseCursor`, buffers later events while serializing paged state, sends `snapshot.complete(baseCursor)`, then emits buffered events. Overflow, an old cursor, a new epoch, or a gap yields `snapshot_required` rather than an unbounded repair attempt.

Mobile behavior:

- Ignore duplicate/older cursors.
- Apply only the exact next offset in the same epoch.
- Stop applying on a gap or epoch change and enter `resyncing`.
- Replace projection with a snapshot and cursor in one SQLite transaction.
- Treat optimistic state as pending, never authoritative.
- On foreground/resume, fetch/validate an authoritative baseline before re-enabling mutations.

Use exponential reconnect backoff with full jitter from about one second to 30 seconds. Network change, foreground transition, and notification tap may trigger one immediate reconnect. Connection heartbeat may use a ten-second ping/pong pattern, but heartbeat is not a business acknowledgement.

### Rationale

Mobile apps commonly sleep longer than a replay window, and desktop processes restart. Snapshot is a normal recovery path. The existing process-local stream watermark is a useful algorithm reference but is not durable or safe as the public cursor.

### Source

- [RFC 6455: WebSocket Ping/Pong](https://www.rfc-editor.org/info/rfc6455/)

## 10. Foreground Connectivity and Notifications

### Decision

WSS exists only while React Native `AppState` is active. When inactive/background, stop reconnect and heartbeat work and close the socket on a best-effort basis. The Relay uses APNs/FCM to hint only completion, failure, or ordinary-input-needed transitions. A push is never state synchronization.

MVP uses `expo-notifications` with Expo Push Service. Store enough registration metadata to process push tickets/receipts, remove `DeviceNotRegistered` tokens, and deduplicate/collapse transitions. Keep the server port able to accept native device tokens so direct APNs/FCM can replace Expo delivery later.

Push payload contains only version, hint ID, opaque machine/session identifiers, and generic kind. It contains no title, prompt, output, code, path, tool name/arguments/result, error detail, answer, credential, key, or ciphertext. Notification tap routes to the target then performs authoritative synchronization. Locked-screen previews remain generic; optional content previews are deferred from v1 despite the spec permitting future opt-in.

### Rationale

iOS may suspend ordinary apps and Android Doze restricts network access. Neither platform supports a reliable permanent background WebSocket. Push delivery may be delayed, duplicated, collapsed, reordered, or dropped, so it can only mark `needsSync`.

### Sources

- [React Native networking](https://reactnative.dev/docs/0.86/network)
- [React Native AppState](https://reactnative.dev/docs/appstate.html)
- [Apple background execution](https://developer.apple.com/documentation/xcode/configuring-background-execution-modes)
- [Android Doze guidance](https://developer.android.com/training/monitoring-device-state/doze-standby)
- [Expo notifications](https://docs.expo.dev/versions/latest/sdk/notifications/)
- [Expo Push Service sending](https://docs.expo.dev/push-notifications/sending-notifications/)
- [Apple notification payload guidance](https://developer.apple.com/library/archive/documentation/NetworkingInternet/Conceptual/RemoteNotificationsPG/CreatingtheNotificationPayload.html)

## 11. Mobile Persistence

### Decision

Use `expo-secure-store` only for device-scoped refresh credentials, signing/encryption keys or native key references, and an encrypted-cache key if encryption at rest is enabled. Short-lived access tokens remain in memory. Do not store transcript JSON or large values in SecureStore.

Use `expo-sqlite` with WAL and `PRAGMA user_version` migrations for a bounded disposable cache containing installation identity, machine projection, session summaries, bounded conversation pages, sync cursors, drafts/read markers, and uncertain-operation identities/results. All queries use bound parameters. Credentials never enter SQLite.

On iOS, Keychain values can survive uninstall while the SQLite app container does not. A missing SQLite installation sentinel causes stale SecureStore entries to be cleared and requires re-pairing. Android uninstall already clears SecureStore. Logout/unpair/revoke clears local keys and cached projection for that authorization.

The first implementation may avoid durable message-body caching to reduce risk. If full transcript caching is enabled for production, it must use SQLCipher or an equivalent reviewed database-encryption configuration with the key in SecureStore; that choice requires a development build and a data-retention policy.

### Sources

- [Expo SecureStore](https://docs.expo.dev/versions/latest/sdk/securestore/)
- [Expo SQLite](https://docs.expo.dev/versions/latest/sdk/sqlite/)

## 12. Payload and Resource Budgets

All limits are measured in UTF-8 bytes and apply to the total result, including details. Parsers validate ciphertext before decryption and plaintext after decryption. JSON depth is bounded. Errors remain valid, bounded structured data.

| Item                         |                          v1 limit |
| ---------------------------- | --------------------------------: |
| WSS authentication frame     |                            16 KiB |
| Sealed envelope              |                           256 KiB |
| Command plaintext            |                           128 KiB |
| Text prompt                  |                            64 KiB |
| Session title                |                         512 bytes |
| Identifier                   |                   128 ASCII bytes |
| Error detail                 |                             4 KiB |
| Activity/tool summary        |                             2 KiB |
| Questions per interaction    |                                32 |
| Options per question         |                                32 |
| Aggregate answer             |                            16 KiB |
| Session catalog page         |             100 items and 192 KiB |
| Conversation page            |              50 items and 192 KiB |
| Live text delta              | 16 KiB; larger deltas are chunked |
| Socket pending bytes         |                             1 MiB |
| Sustained backpressure grace |                        10 seconds |
| Snapshot bootstrap buffer    |           10,000 events or 10 MiB |
| JSON nesting depth           |                                16 |

Disable `perMessageDeflate`: encrypted data does not benefit materially and predictable byte/memory budgets are more important. Oversized content is paginated/chunked with stable identities; never return truncated JSON or repeat omitted data in another field.

## 13. i18n and Accessibility

### Decision

Use the repository's single shared i18n runtime/configuration; do not create a second fallback system. Mobile-owned semantic keys and colocated `en-US`/`zh-CN` bundles live under `apps/mobile/src/i18n`. If the shared React provider remains DOM-independent, broaden its React peer range to cover Expo's supported React 19.2 line and verify one resolved React instance; otherwise expose a React-free factory/provider boundary from the shared i18n package before mobile UI work.

All user-visible route titles, controls, placeholders, permissions explanations, stale/offline states, errors, notifications, accessibility labels, and upgrade messages require both base locales. Stable IDs, paths, user content, model output, and raw logs are not translated.

Mobile implementation uses native accessibility roles/labels, Dynamic Type, safe-area handling, reduced-motion settings, and sufficient touch targets. These are design requirements; the current repository instruction still forbids adding/running UI interaction tests, so true device behavior remains an explicit release gate.

## 14. Service and Desktop Persistence

### Decision

Use PostgreSQL 16+ as the Relay's durable metadata store behind an injected repository/transaction port. Persist account/machine/device authorization, pairing invitation lifecycle, public key material/fingerprints, revocation, push registration, and credential-free audit metadata. Transactional uniqueness/locking atomically consumes pairing invitations and fences conflicting device/lease updates. Encrypt notification tokens at rest. Do not create Relay tables for prompts, messages, conversation pages, tool output, snapshots, or a durable session-event replica.

Use Node SQLite for the desktop operation ledger because the repository already uses `node:sqlite`, it avoids adding a second native database dependency to Electron, and ledger values are small structured identities/digests/results rather than session content. Place it under the desktop application's private data root with directory mode `0700`, file mode `0600`, schema versioning, transactions, and atomic initialization. Desktop machine credentials and private keys stay in Electron `safeStorage`, not SQLite. Fail closed when secure storage is unavailable or Linux selects an insecure basic-text backend, matching current desktop service behavior.

Implement the Relay listener with repository-standard Node HTTP/WebSocket service patterns and injected TLS/proxy configuration. Deploy behind TLS termination with explicit trusted-proxy settings, health/readiness, graceful shutdown, migration locking, and separate production secrets. The feature does not require Kubernetes or a particular cloud vendor.

### Rationale

- Pairing races, revocation, notification-token rotation, and audit retention require durable transactions and indexing; PostgreSQL provides the needed production behavior without placing session content in the service.
- The desktop ledger must survive process/Runtime restarts and reconcile at-most-once effects. SQLite is local, transactional, bounded, and already available in the repository's Node toolchain.
- Provider-independent service ports keep identity, push, storage, and deployment policy in the Relay app rather than the protocol package.

### Alternatives Rejected

- **In-memory Relay metadata**: loses revocation and invitation atomicity across restarts/replicas.
- **Relay Redis as the only database**: useful later for cross-replica ephemeral presence/routing, but not the selected system of record for durable authorization/audit metadata.
- **JSON files for the desktop ledger**: atomic append/reconciliation and indexed idempotency lookup are more error-prone than SQLite.
- **Store session snapshots in PostgreSQL for availability**: violates the single desktop authority and expands privacy/retention scope.

## 15. Validation Strategy

The plan uses non-UI validation allowed by repository policy:

- frozen pnpm install and dependency graph checks;
- `pnpm expo install --check` and `pnpm dlx expo-doctor`;
- mobile app-local typecheck plus affected-package typechecks;
- root lint/format and package-structure checks;
- contract and state-machine tests for strict decoding, protocol versions, authorization, operation crash cuts, cursor replay/snapshot, reconnection, size/depth limits, multibyte input, cache migrations, notification privacy, and revocation;
- RFC HPKE vectors, tamper cases, and Node–React Native interoperability in the blocking crypto spike;
- `pnpm expo export`, Android release compilation, and EAS preview builds.

No UI/DOM/Hook render tests or UI interaction smoke tests are added or run. Required device checks—camera fallback, AppState/network recovery, notification taps, iOS/Android suspension behavior, secure-storage reinstall behavior, accessibility, and real-device encrypted transport—are documented as unexecuted release-risk gates unless the user later changes that constraint. The plan must not claim those behaviors are verified by static or protocol tests.
