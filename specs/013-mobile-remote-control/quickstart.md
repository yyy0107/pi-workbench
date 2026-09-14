# Quickstart: Implementing Workbench Mobile Remote Control

**Feature**: `013-mobile-remote-control`<br>
**Purpose**: dependency-ordered implementation and verification guide; detailed executable tasks are generated later by `speckit-tasks`

## 1. Read the Boundaries First

Before implementation, read:

1. `spec.md` for user-visible scope and acceptance.
2. `research.md` for selected technology and rejected alternatives.
3. `data-model.md` for authority and persistence ownership.
4. `contracts/remote-control-protocol.md` for the only public remote wire surface.
5. `contracts/desktop-bridge.md` for local Pi mapping and lifecycle.
6. `contracts/mobile-client.md` for Expo/client state and dependency restrictions.
7. The nearest `AGENTS.md` for every edited app/package.

The invariant is simple: the phone can manage conversations; it cannot reach the desktop Runtime, toolbox, terminal, files, browser, extensions, model settings, or local credentials.

## 2. Implementation Sequence

### Stage A — Freeze the security and protocol baseline

Create `@workbench/remote-control-contracts` first. Implement strict parsers, canonical encoding, byte/depth budgets, closed commands/events/results, protocol negotiation, cursor helpers, redacted error types, and pairing transcript types.

In parallel with the minimal Expo/Node harness, complete the blocking E2EE spike:

- select a maintained RFC 9180 HPKE implementation only after dependency/security review;
- prove Node ↔ selected Expo/React Native runtime interoperability in both directions;
- run RFC vectors, wrong-key, tampered-header/ciphertext, expiry, and key-rotation cases;
- pin a non-vulnerable version and record the decision;
- stop implementation for explicit product/security direction if no acceptable implementation works. Never silently switch to TLS-only.

Do not build user-visible session transport before this gate passes.

### Stage B — Build transport-neutral client state

Create `@workbench/remote-control-client` with injected fetch/socket/clock/random/storage ports. Implement authentication sequencing, full-jitter reconnect, connection lifecycle, cursor replay/snapshot reducer, pending operation recovery, stale state, pagination, and push-hint deduplication as pure TypeScript.

Keep Expo, React, SQLite, SecureStore, and notification imports out of this package.

### Stage C — Build the Relay domain and deployment app

Create `@workbench/remote-control-relay-server` with interfaces for identity, persistent device/pairing metadata, active machine lease routing, WSS tickets, notification delivery, security audit, clock, and transactional storage. Implement the selected PostgreSQL 16+ durable adapter behind the port; session content remains absent from its schema.

Create `apps/remote-control-relay` as the listener/config/migrations/health/readiness composition. The app injects identity-provider validation, database, WebSocket listener, and Expo Push provider. The package remains Pi-independent.

Validate machine/device tenant isolation, pairing races/expiry, ticket replay, revocation, lease fencing, rate/size/backpressure limits, notification token invalidation, log redaction, and process restart.

### Stage D — Build the desktop bridge and Electron integration

Create `@workbench/pi-runtime-remote-control` with injected local Runtime, Relay, credential, ledger, and lifecycle ports. Use only public Pi RPC/client and runtime transport exports. Do not import `apps/runtime-node`, private session registries, or the process-local StreamHub.

Implement the projection sanitizer before enabling Relay traffic. Then implement operation ledger/reconciliation, command mapping, event epoch/replay ring, snapshot bootstrap, encryption, and device authorization.

Compose one bridge generation in `apps/desktop-electron` after the main process obtains the current `RuntimeConnection`. Store machine credential/private key through the existing fail-closed `safeStorage` pattern. Runtime restart disposes the old bridge, fences its lease, creates a new epoch, and starts with the new connection.

Extend the existing desktop general-settings capability with pairing invitation, safety-code confirmation, paired-device list, and independent revoke controls. Renderer calls a narrow local API and never receives Relay machine credentials, E2EE private keys, or the sidecar token. Add `en-US` and `zh-CN` strings.

### Stage E — Build the Expo app foundation

Scaffold `apps/mobile` through pnpm and Expo's current stable template. Retain Expo-compatible exact React/RN versions and app-local TypeScript. Use Expo Router, Development Build, and CNG; do not commit generated native directories unless a later reviewed native requirement makes them source-owned.

Implement adapters:

- system-browser sign-in with Authorization Code + PKCE;
- QR plus manual pairing input;
- SecureStore credential/key adapter;
- SQLite projection/cache adapter with installation sentinel, WAL, migrations, bound parameters, and retention limits;
- AppState-aware WSS adapter;
- notification registration/response adapter;
- custom-scheme route normalization and root authorization guard;
- shared i18n runtime with app-local `en-US`/`zh-CN` bundle.

If shared `@workbench/i18n` React peer metadata excludes Expo's React 19.2 patch, broaden the compatible React 19.2 range and verify a single resolved React instance. Do not create a second i18n implementation and do not import the DOM-oriented Shell provider.

### Stage F — Implement the narrow mobile product

Implement only:

- signed-out/unpaired landing;
- pairing and confirmation status;
- machine presence/incompatibility state;
- active multi-session list and switching;
- create, rename, pin/unpin, archive;
- bounded conversation and generic activity status;
- text draft/send, stop, and ordinary-question response;
- per-session draft/read/unread state;
- stale/offline/reconnecting and uncertain-operation recovery;
- generic completion/failure/input-needed notification navigation.

No toolbox/terminal/file/editor/diff/browser/extensions/automation/model/provider/full-settings route, component, command, or dependency is added.

### Stage G — Integrate, harden, and prepare release

Run protocol, authorization, projection, crash-recovery, cursor, storage, notification, privacy, build, and package-boundary checks. Exercise at least 200 session summaries and forced disconnects in pure/integration harnesses. Record metrics for latency, convergence, duplicate effects, cache size, and revocation propagation.

Keep mobile builds separate from the existing desktop `pnpm build` until release orchestration explicitly defines both artifacts. Add clear root/CI entry points for mobile export, Android build, EAS preview build, Relay build/migrations, and existing desktop packaging.

## 3. Planned Repository Layout

```text
apps/
├── desktop-electron/                 # Compose bridge; safeStorage and Runtime lifecycle ports
├── mobile/                           # Expo/React Native product
└── remote-control-relay/             # Deployable Relay composition

packages/
├── client/
│   ├── i18n/                         # Shared runtime; peer range only if compatibility requires
│   └── ui-settings-general/           # Desktop pairing/revoke administration UI
├── contracts/
│   └── remote-control-contracts/      # Closed protocol and strict codecs
├── pi-runtime/
│   └── pi-runtime-remote-control/     # Electron-main desktop bridge to local Pi RPC
├── server/
│   └── remote-control-relay-server/   # Relay domain/services/ports
└── transport/
    └── remote-control-client/         # Pure client connection/projection state
```

Each new library package has real `src/` and `lib/` code, public exports, independent English/Chinese README, package-root non-UI tests, and no source nesting beyond one level. Package leaf and `@workbench/*` name match.

## 4. Dependency Rules to Automate

Add static dependency checks for:

- `apps/mobile` may depend on `@workbench/ui-remote-conversation` only through its dedicated Expo DOM entry. Every other `@workbench/ui-*` package plus Shell, Electron, extension host, toolbox, `agent-runtime-client`, Pi Runtime client/adapter, and local Runtime contracts remains forbidden.
- `remote-control-contracts` cannot depend on React, Node services, Pi RPC, Runtime transport, or apps.
- Relay server/app cannot depend on Pi, Electron, desktop client/UI, or unrestricted session contracts.
- Desktop bridge cannot deep-import private Pi server/registry/StreamHub or any `apps/*` source.
- No remote package adds a production cycle.
- No remote command union contains a catch-all method/payload variant.
- No public projection contains `cwd`, absolute path, sidecar access token, tool args/results, attachment bytes, model reasoning, or arbitrary unknown payload.

## 5. Install and Framework Checks

Use pnpm only. Representative commands after packages exist:

```bash
pnpm install --frozen-lockfile
pnpm --dir apps/mobile expo install --check
pnpm dlx expo-doctor apps/mobile
pnpm --filter @workbench/mobile typecheck
pnpm --filter @workbench/remote-control-contracts test
pnpm --filter @workbench/remote-control-client test
pnpm --filter @workbench/remote-control-relay-server test
pnpm --filter @workbench/pi-runtime-remote-control test
pnpm check:workspace-dependencies
pnpm check:package-structure
pnpm lint
pnpm format
```

The exact Expo Doctor invocation must be confirmed against the installed Expo CLI; keep the app-local documented script as the stable CI interface.

## 6. Required Non-UI Test Matrix

### Protocol and limits

- Strict field/discriminator/version parsing.
- UTF-8 byte budgets with ASCII, Chinese, emoji, multiline, and long single-line values.
- Ciphertext-within-limit but decrypted-plaintext-over-limit.
- JSON depth, item count, page byte count, backpressure, and valid bounded errors.

### Pairing and credentials

- Valid QR/manual code, safety-code transcript, and desktop confirmation.
- Expired/reused/competing/wrong-account/denied invitations.
- Ticket expiry/reuse, bad proof/audience/scope, pre-auth business frames.
- Device revoke and one-device isolation.
- Refresh rotation replay and key rotation.

### E2EE and privacy

- RFC HPKE vectors and Node ↔ Expo/React Native interop.
- Wrong keys and bit-level header/ciphertext/key-ID tampering.
- Relay fixture/log/push/error scans for prompts, titles, paths, answers, keys, credentials, and tool payloads.
- Logout/unpair/revoke cleanup of secure material and cached projection.

### Operation recovery

- Duplicate same ID/same digest for every command.
- Same ID/different digest conflict.
- Crash before intent, after intent, after local side effect, and before terminal result persistence.
- Prompt journal contains identity after crash; no duplicate prompt.
- Unknown outcome recovers with the original ID.
- Offline/expired commands never execute later without a new user action.

### Projection and synchronization

- Duplicate cursor, exact-next cursor, gap, epoch change, replay hit, replay eviction.
- Concurrent changes during snapshot and bootstrap overflow.
- Message stream interruption and snapshot/history repair.
- Revision conflict between two phones.
- Path/tool/attachment/unknown payload sanitization.
- 200-session catalog sorting, drafts, read/unread state, bounded memory/cache.

### Lifecycle and integration

- Old desktop lease is fenced by a new generation.
- Local Runtime restart replaces the bridge connection and changes remote epoch.
- Existing Runtime/desktop/web behavior remains unchanged when remote control is disabled.
- Relay restart preserves pairing/device/revocation/audit metadata but does not become a session store.
- Push duplicate/drop/out-of-order behavior changes only `needsSync`.

## 7. Build Checks

After the implementation stages pass their focused tests:

```bash
pnpm typecheck
pnpm check:workspace-dependencies
pnpm check:package-structure
pnpm lint
pnpm format
pnpm --filter @workbench/mobile export
pnpm --filter @workbench/mobile build:android:release
pnpm --filter @workbench/mobile build:preview
pnpm --filter @workbench/remote-control-relay build
pnpm --filter @workbench/desktop-electron build
pnpm build
```

Script names are the intended stable interfaces and must be created as part of implementation; underlying Expo/EAS commands stay encapsulated in the mobile app. iOS release compilation runs on macOS/Xcode or EAS Build, not the current Linux host.

## 8. UI Verification Constraint and Release Gates

Current repository policy says not to add or run UI/DOM/Hook render tests or UI interaction smoke tests. Therefore this feature uses source review, typechecking, pure state/contract tests, production bundling, and native compilation only. Do not start a browser/device merely to claim UI verification.

The following remain explicit, unexecuted release-risk gates until the constraint changes or an authorized release process performs them:

- QR/manual pairing and safety-code comprehension on real devices;
- Wi-Fi/cellular/AppState recovery and foreground WSS behavior;
- Android Doze and iOS suspended/cold-start notification navigation;
- SecureStore uninstall/reinstall and native key invalidation behavior;
- Node ↔ production React Native E2EE on real devices;
- camera/notification/biometric denial fallbacks;
- Dynamic Type, screen reader, reduced motion, safe area, touch target, light/dark appearance;
- end-to-end latency and 200-session interaction on reference devices.

These gates must be reported as not executed; static checks must not be described as device validation.

## 9. Completion Evidence

Implementation is complete only when tasks record:

- exact packages/apps and dependency changes;
- passing focused non-UI tests and final static/build checks;
- proof that no forbidden command/projection/dependency path exists;
- E2EE gate evidence and selected implementation/version;
- operation crash-recovery evidence, especially text send;
- cursor/snapshot and Runtime restart evidence;
- both base locale coverage;
- known unexecuted device gates and release owner;
- no modification of existing stable IDs, local Runtime protocol, or session persistence format unless separately specified and migrated.
