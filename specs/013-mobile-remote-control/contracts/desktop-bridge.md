# Contract: Desktop Remote Bridge

**Owner**: `@workbench/pi-runtime-remote-control`<br>
**Composition owner**: `apps/desktop-electron` main process<br>
**Authoritative dependency**: the existing loopback Runtime/Pi session instance

## 1. Boundary

The bridge is the only component allowed to translate the public remote-control protocol into local Workbench operations. It is a package with injected ports and no Electron imports. Electron main supplies the current local `RuntimeConnection`, encrypted credential storage, Relay socket/fetch primitives, lifecycle signals, and clock/randomness.

The bridge:

- initiates an outbound WSS connection to Relay;
- holds device authorizations/public keys and validates every sealed request again;
- builds a mobile-safe session projection from public Pi client APIs/streams;
- maintains the remote epoch/event ring and durable operation ledger;
- performs an exhaustive command-to-local-operation mapping;
- emits encrypted results/events/snapshots per authorized phone;
- derives content-free completed/failed/input-needed notification intents from authoritative public Runtime streams;
- changes epoch and requires snapshot when local Runtime identity changes.

The bridge never exposes the local Runtime listener, forwards a local access token, imports private Pi server registries/StreamHub, creates another session service, or accepts arbitrary RPC.

## 2. Injected Ports

The exact TypeScript names may change during implementation, but the capabilities are fixed:

```ts
interface DesktopBridgeRuntimePort {
  listSessions(input: { cursor?: string; limit: number }): Promise<DesktopSessionPage>;
  createSession(input: {
    workspaceId?: string;
    requestedSessionId: string;
  }): Promise<{ sessionId: string }>;
  readHistory(input: {
    sessionId: string;
    cursor?: string;
    limit: number;
  }): Promise<DesktopHistoryPage>;
  sendText(input: {
    sessionId: string;
    text: string;
    clientMessageId: string;
  }): Promise<{ messageId: string }>;
  stop(input: { sessionId: string }): Promise<void>;
  rename(input: { sessionId: string; title: string }): Promise<{ revision: string }>;
  setPinned(input: { sessionId: string; pinned: boolean }): Promise<{ revision: string }>;
  setArchived(input: { sessionId: string; archived: true }): Promise<{ revision: string }>;
  answerOrdinaryQuestion(input: DesktopQuestionAnswer): Promise<void>;
  subscribe(observer: DesktopRuntimeObserver): Disposable;
}

interface DesktopBridgeCredentialPort {
  loadMachineCredential(): Promise<MachineCredential | undefined>;
  saveMachineCredential(value: MachineCredential): Promise<void>;
  deleteMachineCredential(): Promise<void>;
  loadDesktopKey(): Promise<DesktopEncryptionKey | undefined>;
  saveDesktopKey(value: DesktopEncryptionKey): Promise<void>;
}

interface DesktopBridgeLedgerPort {
  begin(input: CanonicalRemoteIntent): Promise<BeginResult>;
  markSucceeded(input: TerminalOperationRecord): Promise<void>;
  markRejected(input: TerminalOperationRecord): Promise<void>;
  get(key: OperationLedgerKey): Promise<OperationRecord | undefined>;
  reconcileIncomplete(): AsyncIterable<OperationRecord>;
}
```

`DesktopBridgeRuntimePort` is implemented from public `@workbench/pi-rpc-client/api`, public connection helpers, and `PiConnectionController` over the one current local Runtime. No mobile/Relay code receives that `RuntimeConnection`.

## 3. Local Mapping

| Remote command               | Local public capability                                                  | Projection/security rule                                                                                       |
| ---------------------------- | ------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------- |
| `session.create`             | `createPiRpcSession`                                                     | Opaque known `workspaceId` or desktop default only; allocate requested ID at durable intent                    |
| `session.send`               | `promptPiRpcSession`                                                     | Build one text block; no attachment/file/image/composer command; persist client message identity before invoke |
| `session.stop`               | `cancelPiRpcSession`                                                     | Repeat after terminal state returns same successful/reconciled outcome                                         |
| `session.rename`             | `renamePiRpcSession`                                                     | Check expected remote entity revision first                                                                    |
| `session.setPinned`          | `setPiWorkspaceSessionPinned`                                            | Set-to-value, not toggle; check revision                                                                       |
| `session.setArchived`        | `archivePiWorkspaceSession`                                              | v1 accepts only `archived: true`; no unarchive/delete                                                          |
| `interaction.answerQuestion` | Existing pending ordinary-question owner through an injected public port | Must still be pending, revision-equal, unexpired; tool approvals rejected                                      |
| Catalog/history              | list/history/workspace public Pi APIs                                    | Remove paths, attachment data, raw tools/results, reasoning, unknown projections                               |

If the existing public Pi boundary cannot answer ordinary questions without importing private ownership, implementation first adds a narrow injected public port to the existing installation. It must not construct a second registry/facade or deep-import server internals.

## 4. Projection Rules

Allowed list/history fields are those in the remote protocol contract. In particular:

- Replace `WorkspaceView.rootPath`, `cwd`, file URIs, and local resource identifiers with an opaque `workspaceId` and bounded display name.
- Convert messages to bounded user/assistant text.
- Convert tool lifecycle to a closed `activity-summary` with generic display name/status only.
- Remove tool args/results, file blocks/sources, terminal output, browser state, arbitrary content cards, extension metadata, model reasoning, raw errors, and unknown fields.
- Bound every page/item by UTF-8 bytes before encryption. If content cannot be represented safely, emit a closed omitted/status item with a local-desktop viewing instruction.
- Filter archived sessions from the default list. A read-only archived listing may be added only if the final mobile flow needs it; remote restore/delete remains absent.

Projection code must be tested with deliberately hostile Pi fixtures containing secrets in paths, tool arguments/results, attachments, and unknown events.

## 5. Operation Ledger and Crash Recovery

The ledger key is `(machineId, deviceId, operationId)`. `begin` canonicalizes the command, hashes it, and transactionally records intent before any local side effect.

Required reconciliation per operation:

- **Create**: requested session identity is fixed at intent acceptance; after crash, check for that session before create.
- **Send**: client message/operation identity must be recorded in the authoritative session journal or mutation owner before execution. A bridge-only memory/database entry is insufficient for a crash after local acceptance but before result storage.
- **Stop**: if the run is already terminal, return the previously valid successful result.
- **Rename/pin/archive**: set-to-value operations re-read current state and return success if the requested value is already authoritative.
- **Question answer**: resolved interaction outcome is retained/reconciled; duplicate answer returns original outcome and does not answer a newer interaction revision.

On startup, `reconcileIncomplete` resolves each durable accepted intent before admitting a conflicting new request. Completed entries remain at least seven days and among the most recent 10,000; incomplete entries are never deleted only to meet a capacity limit.

## 6. Runtime and Electron Lifecycle

```text
Electron main receives RuntimeConnection
  -> create local public Runtime fetch/socket factories
  -> start exactly one Desktop Remote Bridge generation
  -> establish authenticated outbound Relay lease

Runtime exits/restarts or RuntimeConnection changes
  -> stop accepting remote operations
  -> dispose local subscriptions/socket generation
  -> fence the old Relay lease
  -> start with the new local RuntimeConnection
  -> create a new remote epoch and require snapshot

Electron quits/signs out/disables remote control
  -> dispose bridge and Relay lease
  -> revoke/delete appropriate machine credential according to action
  -> leave local Runtime behavior unchanged
```

Relay credentials and desktop private keys are stored through Electron `safeStorage` with a fail-closed backend policy and `0600` file permissions. They are distinct from the sidecar token and other application credentials. Logs contain no keys, tokens, QR payloads, sealed payloads, local paths, prompts, or outputs.

The runtime monitor uses only public `PiConnectionController` and Runtime WebSocket factories. It projects session-stream events before publishing them, never forwards host error text, and sends only `{ sessionId, transitionRevision, kind }` to Relay for a completed, failed, or ordinary-input-needed transition. Relay owns foreground suppression and authorization/registration rechecks; notification delivery is never treated as state synchronization.

## 7. Required Desktop Tests

- Exhaustive allowlist mapping and explicit rejection of every out-of-scope variant.
- Sanitization of cwd/path, attachment, raw tool arguments/results, model reasoning, unknown host events, and unrestricted Runtime errors.
- Same-ID retries at crash cuts before ledger write, after intent write, after local side effect, and before result write.
- Authoritative send deduplication after a local journal write and bridge restart.
- Runtime restart replaces the connection, fences old lease, changes epoch, and forces snapshot without creating a second Pi registry.
- Multi-device revision conflict for rename/pin/archive.
- Revoked device and stale lease are rejected even when Relay sends a syntactically valid request.
- Snapshot construction with concurrent updates, replay eviction, bootstrap overflow, and slow consumer.
- Packaged desktop composition includes one bridge generation and keeps its credentials outside renderer/preload/argv/env/logs.
