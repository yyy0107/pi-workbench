# Contract: Mobile Client Boundary

**Composition owner**: `apps/mobile`<br>
**Reusable logic owner**: `@workbench/remote-control-client`

## 1. Dependency Boundary

`@workbench/remote-control-client` is pure TypeScript and depends on `@workbench/remote-control-contracts`. It owns protocol decoding, connection/reconnect state, projection reduction, cursor recovery, operation tracking, bounded pagination, and platform-neutral ports.

`apps/mobile` owns Expo Router screens and the adapters for fetch/WebSocket, AppState, SecureStore, SQLite, notifications, camera/manual pairing, deep links, and native lifecycle.

The mobile app must not depend on:

- `@workbench/agent-runtime-client`;
- `@workbench/pi-runtime-client` or `@workbench/pi-conversation-adapter`;
- any desktop UI package except the exact `@workbench/ui-remote-conversation` DOM presentation boundary; Shell, Lexical editing, Electron, extension host, toolbox, and every other `@workbench/ui-*` package remain forbidden;
- local `@workbench/runtime-contracts` or a desktop-sidecar token;
- private/deep package source paths.

## 2. Platform Ports

```ts
interface MobileRemoteTransportPort {
  request<T>(request: BoundedHttpRequest): Promise<T>;
  connect(input: SocketConnectInput): MobileRemoteSocket;
}

interface MobileCredentialPort {
  loadDeviceIdentity(): Promise<DeviceIdentity | undefined>;
  saveDeviceIdentity(value: DeviceIdentity): Promise<void>;
  deleteDeviceIdentity(): Promise<void>;
  loadPrivateKey(keyId: string): Promise<PrivateKeyHandle | undefined>;
}

interface MobileProjectionStorePort {
  loadMachine(machineId: string): Promise<CachedMachine | undefined>;
  commitSnapshot(input: SnapshotCommit): Promise<void>; // snapshot + cursor, one transaction
  applyEvents(input: ContiguousEventBatch): Promise<void>;
  saveDraft(input: SessionDraft): Promise<void>;
  saveOperation(input: LocalOperationRecord): Promise<void>;
  clearAuthorization(input: { machineId?: string; accountId: string }): Promise<void>;
}

interface MobileLifecyclePort {
  getState(): "active" | "inactive" | "background";
  subscribe(listener: (state: MobileLifecycleState) => void): Disposable;
}

interface MobileNotificationPort {
  getPermission(): Promise<NotificationPermissionState>;
  register(): Promise<NotificationProviderToken | undefined>;
  subscribeToResponses(listener: (hint: RemotePushHintV1) => void): Disposable;
}
```

Expo adapters use async SecureStore APIs, parameterized SQLite queries, WAL, and `PRAGMA user_version` migrations. Credentials/private keys do not enter SQLite.

## 3. App State Machine

```text
uninstalled/uninitialized
  -> signed-out
  -> signed-in-unpaired
  -> paired-offline
  -> synchronizing
  -> ready

ready
  -> reconnecting (socket/network interruption)
  -> suspended (AppState inactive/background)
  -> incompatible (protocol range mismatch)
  -> revoked (server/device revocation)

reconnecting/suspended
  -> synchronizing (foreground/network recovery)
  -> paired-offline (desktop not leased)

any paired state
  -> revoked/signed-out (clear keys, credentials, projections as appropriate)
```

Only `ready` with a current desktop lease and contiguous authoritative projection permits mutations. Cached content in every other state is visibly stale. Draft editing is allowed offline, but submission always requires a fresh explicit user action after readiness returns.

## 4. Connection Lifecycle

1. On `active`, refresh the short account credential if needed, retrieve machine metadata/ticket over HTTPS, and authenticate WSS with a first-frame proof.
2. Send last cursor and unresolved operation IDs.
3. Apply replay only if cursor is exact-next in the same epoch. Otherwise request/accept a complete snapshot.
4. Transition to `ready` only after snapshot/replay and machine lease validation.
5. Use full-jitter exponential backoff from about one to 30 seconds. One immediate retry is allowed after network change, app foreground, or notification tap.
6. On `inactive/background`, stop heartbeat/reconnect timers and close the socket best-effort. Do not rely on WSS for background work.
7. A push sets `needsSync` and a route target only. On tap/foreground, synchronize before showing content as current or enabling actions.

Socket pending bytes are capped at 1 MiB; sustained backpressure beyond ten seconds disconnects and requires recovery. Incoming frames are budget-checked before and after decryption.

## 5. Operation UX Semantics

- Generate one stable operation ID for one explicit user intent and persist it before send.
- `accepted` means desktop recorded the intent, not that the session visibly changed yet.
- Keep pending state until a terminal result and/or projection cursor reaches `appliedCursor`.
- If the connection drops with unknown outcome, show “checking outcome” and query/reconnect with the same ID. Do not offer a fresh-ID retry until the original is terminal/not found and the user explicitly repeats the action.
- When offline before send, save text only as a draft. Do not create a remote operation and do not auto-submit later.
- Preserve draft, read position, unread state, and visible run status separately per `(machineId, sessionId)`.
- Revision conflict replaces optimistic state with the returned/current authoritative state and presents a localized retry choice.

## 6. Route Contract

```text
/
  Signed-out, unpaired, or paired-machine landing state

/pair
  QR scan and manual-code alternative; camera denial never blocks manual pairing

/machines/[machineId]/sessions
  Active session list and machine status

/machines/[machineId]/sessions/[sessionId]
  Bounded conversation, text composer, stop, rename/pin/archive actions
```

Custom scheme is `workbench-remote`. Deep links and push responses provide only validated opaque IDs. Root layout checks authentication, device authorization, protocol compatibility, and machine membership before rendering the route. Invalid/stale targets navigate to a localized safe state; they never reveal whether an unauthorized session exists.

## 7. Mobile Surface Contract

The first release provides:

- sign-in/out;
- pair by QR or manual code and show safety code/desktop confirmation progress;
- paired machine list/status and device-revoked/incompatible handling;
- active session list, switch, create, rename, pin/unpin, and archive;
- bounded conversation display for every projected AI message, projected raw tool input/output, and generic activity status; the embedded presentation reuses desktop message, Markdown, tool-call, disclosure, and semantic-token primitives through `@workbench/ui-remote-conversation`;
- text-only composer, send status, stop, and ordinary-question answer;
- generic completion/failure/input-needed notifications;
- explicit stale/offline/reconnecting states and per-session drafts/unread markers.

It does not provide an empty or hidden placeholder for toolbox/terminal/files/editor/diff/browser/extensions/automation/model/provider/general settings. The DOM boundary accepts only serializable `RemoteConversationItemV1` projection data and a bounded load-more native action; it does not receive a Runtime connection or expose those routes and commands.

## 8. i18n Contract

Use the repository shared i18n runtime/config and an app-local mobile bundle with `en-US` and `zh-CN` key parity. Required keys include authentication, pairing, permission explanations, presence states, session actions, run states, stale/cache labels, operation outcomes, protocol upgrade, revocation, errors, notifications, and accessibility labels.

The mobile app owns locale persistence/platform effects. Its isolated DOM component uses the shared DOM-neutral `I18nProvider` with only the presentation bundles exported by `@workbench/ui-remote-conversation`; it does not import the Shell i18n provider or desktop bundle registry. The Metro resolver pins linked workspace sources to Expo's app-local React runtime.

## 9. Local Data and Privacy

- SecureStore: refresh credential, signing/E2EE key material or key handle, optional SQLCipher key.
- Memory only: short-lived access token, decrypted live frame contents beyond current UI state.
- SQLite: installation sentinel, bounded machine/session projection, optional bounded messages, cursor, drafts/read state, unresolved operation IDs/results, notification dedupe.
- No credentials in SQLite; no conversation/tool content in push payload; no raw sensitive content in analytics/crash logs.
- Missing SQLite installation sentinel on startup clears surviving iOS Keychain entries and requires sign-in/pairing again.
- Logout/unpair/revoke deletes matching credentials, keys, cache, drafts as defined by the user action; another paired device remains unaffected.

## 10. Static and Non-UI Verification

- App-local typecheck resolves Expo's supported React/TypeScript and no duplicate React/RN.
- Dependency rules permit `@workbench/ui-remote-conversation` only from the dedicated `remote-conversation.dom.tsx` entry and reject every other desktop UI import plus Shell, Pi Runtime client, agent Runtime client, Electron, extension, toolbox, and local Runtime contracts.
- Pure state tests cover lifecycle, backoff, cursor duplicate/gap/epoch, snapshot transaction, stale-state action disablement, operation uncertainty, draft preservation, and push dedupe.
- Storage tests cover migrations, bound parameters, multibyte limits, LRU/retention, installation-sentinel cleanup, and adapter failures.
- i18n key/parameter parity validates both base locales.
- `pnpm expo install --check`, Expo Doctor, production export, Android release compile, and EAS preview build validate dependency/native bundling stages.

Repository policy forbids adding/running UI/DOM/Hook render tests or UI interaction smoke. Real-device pairing, lifecycle, Doze/suspension, notification tap, secure-storage reinstall, accessibility, and Node↔React Native E2EE behaviors remain explicit release-risk gates and cannot be claimed from static tests.
