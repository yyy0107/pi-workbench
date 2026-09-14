# Data Model: Workbench Mobile Remote Control

**Feature**: `013-mobile-remote-control`<br>
**Date**: 2026-09-13

This model separates authoritative desktop session data, Relay routing/security metadata, and the phone's disposable projection. Identifiers are opaque strings of at most 128 ASCII bytes. Times are UTC RFC 3339 strings. Counters that can exceed JavaScript's safe integer range are decimal strings.

## Ownership Map

| Entity                              | Authoritative owner                              | Relay persistence                                                 | Mobile persistence                                                 |
| ----------------------------------- | ------------------------------------------------ | ----------------------------------------------------------------- | ------------------------------------------------------------------ |
| Account                             | Identity provider/account service                | Identifier and authorization reference only                       | Current account identifier and short-lived in-memory access token  |
| Desktop machine                     | Desktop installation/account service             | Machine registration and active lease metadata                    | Bounded machine projection                                         |
| Paired mobile device                | Account/device service with desktop confirmation | Device authorization, key fingerprints, scopes, revocation        | Current device identity and credentials/keys in SecureStore        |
| Pairing invitation                  | Pairing service and initiating desktop           | Verification material until consumed/expired                      | Claim progress only; secret is not retained after completion       |
| Session/conversation/run            | Desktop Workbench session owner                  | None beyond opaque routing IDs                                    | Bounded stale-capable projection/cache                             |
| Remote operation ledger             | Desktop Remote Bridge                            | Optional encrypted in-flight delivery record until receipt/expiry | Pending/uncertain identity and last known result                   |
| Remote projection/cursor/event ring | Desktop Remote Bridge                            | None                                                              | Snapshot, cursor, read state, and bounded history cache            |
| Notification registration           | Device/notification service                      | Delivery token and privacy-safe preferences                       | Current permission/registration status                             |
| Security audit event                | Account/Relay/Desktop according to event source  | Credential-free metadata                                          | Not retained except user-facing recent device activity if required |

## Entity Relationships

```text
Account
├── 0..* DesktopMachine
└── 0..* MobileDevice

DesktopMachine
├── 0..* PairingInvitation
├── 0..* DeviceAuthorization ── 1 MobileDevice
├── 0..* RemoteSessionSummary ── 0..* RemoteConversationItem
├── 0..* RemoteOperation
└── 1 RemoteProjection ── 0..* RemoteEvent

MobileDevice
├── 0..* DeviceAuthorization
└── 0..* NotificationRegistration
```

## 1. Account

The identity boundary shared by paired phones and computers.

| Field       | Type                  | Rules                                                                                                                           |
| ----------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `accountId` | opaque string         | Required; identity-provider subject mapped to Workbench account; never accepted from an untrusted payload without token binding |
| `status`    | `active \| suspended` | Suspended accounts cannot pair, refresh credentials, connect, read, or mutate                                                   |

The mobile release targets individual accounts. Shared workspace administration and delegated device management are out of scope.

## 2. DesktopMachine

An installed Workbench desktop/runtime that owns sessions and maintains an outbound Relay lease.

| Field                        | Type                                                | Rules                                                                |
| ---------------------------- | --------------------------------------------------- | -------------------------------------------------------------------- |
| `machineId`                  | opaque string                                       | Stable per installation; generated with at least 128 bits of entropy |
| `accountId`                  | opaque string                                       | Owning account                                                       |
| `displayName`                | string                                              | 1–128 user-visible characters; both clients treat it as user content |
| `protocolRange`              | `{min, max}`                                        | Supported remote protocol versions                                   |
| `desktopEncryptionKeyId`     | string                                              | Active long-term remote E2EE public-key identifier                   |
| `desktopEncryptionPublicKey` | bytes/base64url                                     | Public material only; fingerprint is bound into pairing              |
| `presenceState`              | `online \| offline \| reconnecting \| incompatible` | Derived from active fenced lease and protocol negotiation            |
| `leaseGeneration`            | opaque string                                       | New generation fences old sockets after reconnect/takeover           |
| `lastSeenAt`                 | timestamp                                           | Updated from authenticated desktop lease traffic                     |
| `createdAt` / `updatedAt`    | timestamp                                           | Audit metadata                                                       |

### Presence Transitions

```text
offline ── valid authenticated lease ──> online
online ── transport interruption ─────> reconnecting
reconnecting ── grace expires ────────> offline
reconnecting ── newer valid lease ────> online
any ── no protocol overlap ───────────> incompatible
incompatible ── compatible upgrade ──> offline/online after negotiation
```

Only one lease generation may route commands at a time. A recovered old socket cannot regain authority.

## 3. MobileDevice

A phone installation registered to an account. It is independently revocable.

| Field                                    | Type                | Rules                                                                    |
| ---------------------------------------- | ------------------- | ------------------------------------------------------------------------ |
| `deviceId`                               | opaque string       | Stable for the app installation, at least 128 bits of entropy            |
| `accountId`                              | opaque string       | Bound from authenticated login, never chosen by the client request       |
| `displayName`                            | string              | 1–128 characters                                                         |
| `platform`                               | `ios \| android`    | Informational and audit use                                              |
| `appVersion`                             | string              | Bounded, validated version                                               |
| `protocolRange`                          | `{min, max}`        | Supported protocol versions                                              |
| `signingKeyFingerprint`                  | string              | Fingerprint of mobile proof-of-possession key                            |
| `encryptionKeyId`                        | string              | Current remote E2EE key identifier                                       |
| `encryptionPublicKey`                    | bytes/base64url     | Public material only                                                     |
| `state`                                  | `active \| revoked` | Revocation blocks new HTTP, WSS, reads, mutations, and push registration |
| `createdAt` / `lastUsedAt` / `revokedAt` | timestamp           | No session content                                                       |

Revoking one device does not rotate or revoke another device's authorization. A mobile logout removes its local credentials and cache even if server revocation is temporarily unavailable; server logout/revoke is retried as an explicit account action, not a session mutation.

## 4. DeviceAuthorization

The many-to-many authorization between one phone and one desktop.

| Field                                  | Type                | Rules                                                                    |
| -------------------------------------- | ------------------- | ------------------------------------------------------------------------ |
| `authorizationId`                      | opaque string       | Stable server identity                                                   |
| `accountId` / `machineId` / `deviceId` | opaque string       | Must refer to one account boundary                                       |
| `allowedActions`                       | closed set          | Subset of `sessions.read/create/send/stop/organize/interactions.respond` |
| `desktopEncryptionKeyId`               | string              | Key accepted by mobile for this machine                                  |
| `mobileEncryptionKeyId`                | string              | Key accepted by desktop for this phone                                   |
| `state`                                | `active \| revoked` | Checked by Relay and desktop                                             |
| `confirmedAt` / `revokedAt`            | timestamp           | Desktop confirmation and later revocation                                |
| `revision`                             | opaque string       | Changes on scope/key/state update                                        |

The first release grants the fixed minimal scope set; it does not expose a generic permission editor. Security-sensitive tool approval is absent from `allowedActions`.

## 5. PairingInvitation

A short-lived, single-use desktop-initiated authorization request.

| Field                             | Type              | Rules                                         |
| --------------------------------- | ----------------- | --------------------------------------------- |
| `pairingId`                       | 128-bit opaque ID | Public lookup identity                        |
| `machineId` / `accountId`         | opaque string     | Bound when desktop creates invitation         |
| `secretVerifier`                  | bytes             | Relay stores verifier, never plaintext secret |
| `desktopEphemeralPublicKey`       | bytes             | Pairing transcript material                   |
| `desktopEncryptionKeyFingerprint` | string            | Prevents Relay key substitution               |
| `protocolVersion`                 | integer           | Proposed compatible version                   |
| `createdAt` / `expiresAt`         | timestamp         | Default two minutes, maximum five             |
| `state`                           | see below         | Exactly one terminal outcome                  |
| `claim`                           | `PairingClaim?`   | At most one active claim                      |

`PairingClaim` contains authenticated account/device identifiers, mobile public keys and fingerprints, transcript proof, device display metadata, and claim time. It does not include a reusable desktop credential.

### Pairing State Machine

```text
created
  ├─ valid phone claim ─────────> claimed
  ├─ timeout ───────────────────> expired
  └─ desktop cancel ────────────> denied

claimed
  ├─ desktop verifies + confirms > consumed
  ├─ desktop rejects ───────────> denied
  ├─ timeout ───────────────────> expired
  └─ transcript/account mismatch > invalidated
```

`consumed`, `denied`, `expired`, and `invalidated` are terminal. A terminal invitation cannot be reactivated or claimed by a competing phone.

## 6. RemoteSessionSummary

The mobile-safe list projection of an authoritative desktop session.

| Field                 | Type                                       | Rules                                                     |
| --------------------- | ------------------------------------------ | --------------------------------------------------------- |
| `sessionId`           | opaque string                              | Desktop-authoritative identity                            |
| `workspaceId`         | opaque string or absent                    | Selected from an allowed desktop projection; never a path |
| `title`               | string                                     | At most 512 UTF-8 bytes                                   |
| `updatedAt`           | timestamp                                  | Used for recent-activity ordering                         |
| `pinned` / `archived` | boolean                                    | Archive restore remains desktop-only                      |
| `attention`           | `none \| unread \| input-needed \| failed` | Mobile display state, not an authorization decision       |
| `runState`            | see below                                  | Current authoritative execution state                     |
| `entityRevision`      | opaque string                              | Required for conflict-aware organization mutations        |
| `lastMessagePreview`  | optional bounded text                      | Display-safe and excluded from push by default            |

`RemoteRunState` is a closed union: `idle`, `queued`, `running`, `waiting-for-input`, `stopping`, `completed`, `stopped`, or `failed`. It never includes raw Runtime state or arbitrary error data.

## 7. RemoteConversationPage and RemoteConversationItem

A bounded ordered slice of content safe for the phone surface.

### Page

| Field              | Type                       | Rules                                                       |
| ------------------ | -------------------------- | ----------------------------------------------------------- |
| `sessionId`        | opaque string              | Must be authorized for the current device                   |
| `items`            | `RemoteConversationItem[]` | At most 50 items and 192 KiB encoded plaintext in total     |
| `historyCursor`    | opaque string              | Bound to session/branch/page boundary; not client-generated |
| `nextCursor`       | opaque string or absent    | Earlier-page continuation                                   |
| `sessionRevision`  | opaque string              | Page consistency marker                                     |
| `projectionCursor` | `RemoteCursor`             | Remote projection point reflected by the page               |

### Item Union

| Variant             | Allowed fields                                                                    |
| ------------------- | --------------------------------------------------------------------------------- |
| `user-message`      | Item identity, timestamp, bounded text, delivery state                            |
| `assistant-message` | Item identity, timestamp, bounded text, completion/stream state                   |
| `activity-summary`  | Item identity, timestamp, closed status kind and bounded display name/summary     |
| `ordinary-question` | Interaction identity/revision/expiry, bounded questions/options, no tool approval |
| `system-status`     | Closed privacy-safe state code and timestamp                                      |

No item has raw tool arguments/result, file path, terminal output, browser state, model reasoning, arbitrary card payload, `unknown`, or open-ended Runtime event data.

## 8. RemoteInteraction

An ordinary question already published by the desktop session and safe for mobile response.

| Field                         | Type                             | Rules                                            |
| ----------------------------- | -------------------------------- | ------------------------------------------------ |
| `interactionId` / `sessionId` | opaque string                    | Desktop-issued                                   |
| `revision`                    | opaque string                    | Must match when answering                        |
| `questions`                   | bounded closed structure         | At most 32 questions and 32 options per question |
| `expiresAt`                   | timestamp                        | Answer operation cannot outlive it               |
| `state`                       | `pending \| resolved \| expired` | Only pending accepts a response                  |

The union intentionally lacks any security-sensitive tool approval variant.

## 9. RemoteOperation

The durable identity and outcome for one requested mutation.

| Field                       | Type                           | Rules                                                                    |
| --------------------------- | ------------------------------ | ------------------------------------------------------------------------ |
| `operationId`               | unique 128-bit ID              | Created once per user intent; stable across retries                      |
| `machineId` / `deviceId`    | opaque string                  | Part of ledger key                                                       |
| `issuedAt` / `expiresAt`    | timestamp                      | Desktop rejects stale work                                               |
| `commandType`               | closed enum                    | Create/send/stop/rename/set-pinned/set-archived/ordinary-question-answer |
| `canonicalDigest`           | SHA-256                        | Digest of normalized command plaintext                                   |
| `state`                     | see below                      | Durable desktop state                                                    |
| `domainIdentity`            | optional object                | Stable session/message/interaction reconciliation ID                     |
| `resultCode`                | stable enum or absent          | No unrestricted exception object                                         |
| `resultValue`               | bounded closed union or absent | At most IDs/current revisions/status                                     |
| `appliedCursor`             | `RemoteCursor?`                | Cursor at which projection includes the mutation                         |
| `acceptedAt` / `finishedAt` | timestamp or absent            | Audit/recovery metadata                                                  |

### Operation State Machine

```text
received
  ├─ validation/auth/precondition failure ─> rejected
  ├─ already expired ──────────────────────> expired
  └─ durable intent committed ─────────────> accepted

accepted
  ├─ domain effect reconciled + result saved > succeeded
  ├─ domain rejection + result saved ───────> rejected
  └─ expiry before permissible execution ──> expired
```

`succeeded`, `rejected`, and `expired` are terminal. A duplicate with matching digest returns current/original state. A duplicate identity with a different digest returns `operation_id_conflict` and never changes the stored operation.

Mobile-only UI status may include `preparing`, `sending`, and `outcome-unknown`; these are not desktop ledger states. `outcome-unknown` is resolved by status lookup/reconnect using the same ID.

## 10. RemoteProjection, Cursor, and Event

### RemoteCursor

| Field    | Type                 | Rules                                                    |
| -------- | -------------------- | -------------------------------------------------------- |
| `epoch`  | random opaque string | Changes when the bridge cannot guarantee continuity      |
| `offset` | decimal string       | Strictly increasing unsigned 64-bit integer within epoch |

### RemoteProjection

| Field          | Type                       | Rules                                                                   |
| -------------- | -------------------------- | ----------------------------------------------------------------------- |
| `machine`      | mobile-safe machine status | No credentials or network internals                                     |
| `sessions`     | bounded/paged summaries    | Default active sessions; archived view is separate/read-only if exposed |
| `openSession`  | optional bounded detail    | Content requested by active subscriber                                  |
| `interactions` | pending ordinary questions | No sensitive approvals                                                  |
| `baseCursor`   | `RemoteCursor`             | Atomic with projection snapshot                                         |

### RemoteEvent Union

- `machine.presenceChanged`
- `session.upserted`
- `session.removed`
- `session.runChanged`
- `session.messageAppended`
- `session.messageDelta`
- `interaction.upserted`
- `interaction.resolved`
- `operation.result`

Every event has exact protocol version, event identity, cursor, creation time, and one bounded typed payload. A delta is at most 16 KiB; larger text uses stable chunk identity and order. The client applies only contiguous cursors.

## 11. Mobile Local Projection

SQLite is a cache, not a source of truth. Suggested logical tables are shown here; physical schema can combine bounded JSON columns where migrations and queries remain explicit.

| Table                | Primary key                         | Purpose and retention                                                                   |
| -------------------- | ----------------------------------- | --------------------------------------------------------------------------------------- |
| `installation`       | singleton                           | Installation sentinel/schema metadata; absence invalidates surviving iOS Keychain state |
| `machines`           | `machine_id`                        | Last safe machine projection, presence and stale marker                                 |
| `session_summaries`  | `(machine_id, session_id)`          | Bounded list state, local unread marker and authoritative revision                      |
| `conversation_items` | `(machine_id, session_id, item_id)` | Optional bounded/LRU content cache; never an unrestricted tool result                   |
| `sync_cursors`       | `machine_id`                        | Last atomically applied epoch/offset and snapshot time                                  |
| `drafts`             | `(machine_id, session_id)`          | User-entered unsent text; never auto-submitted after reconnect                          |
| `read_positions`     | `(machine_id, session_id)`          | Local read marker and unread derivation input                                           |
| `operations`         | `(machine_id, operation_id)`        | Pending/uncertain identity and bounded result until reconciled                          |
| `notification_hints` | `hint_id`                           | Short-lived deduplication/route target only                                             |

Every cached authoritative row has `syncedAt` and/or projection cursor. When the app cannot establish freshness, all displayed cache is marked stale and mutations are disabled. Snapshot rows and `sync_cursors` update in one transaction.

SecureStore keys are namespaced by installation/account/device. It stores refresh credentials, proof-of-possession key material or references, E2EE key material or references, and optional database encryption key only.

## 12. NotificationRegistration and PushHint

### NotificationRegistration

| Field                         | Type                           | Rules                                                             |
| ----------------------------- | ------------------------------ | ----------------------------------------------------------------- |
| `registrationId`              | opaque string                  | Server identity                                                   |
| `deviceId`                    | opaque string                  | Must be active                                                    |
| `provider`                    | `expo \| apns \| fcm`          | MVP uses `expo`; abstraction retains native option                |
| `token`                       | secret string                  | Encrypted at rest and never logged or returned after registration |
| `environment`                 | `development \| production`    | Prevents cross-environment delivery                               |
| `permissionState`             | bounded enum                   | Client-reported; denial does not block foreground use             |
| `updatedAt` / `lastReceiptAt` | timestamp                      | Rotation/health                                                   |
| `state`                       | `active \| invalid \| revoked` | `DeviceNotRegistered` makes it invalid                            |

### RemotePushHint

Contains only protocol version, unique hint ID, opaque machine ID, optional opaque session ID, and `attention` or `state-changed` kind. It cannot contain session title or any conversation/tool content. Receipt changes only local `needsSync`; it never applies an authoritative session transition.

## 13. SecurityAuditEvent

| Field                                                    | Type                      | Rules                                                                                                                |
| -------------------------------------------------------- | ------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `auditId`                                                | opaque string             | Unique                                                                                                               |
| `occurredAt`                                             | timestamp                 | UTC                                                                                                                  |
| `accountId` / optional `machineId` / optional `deviceId` | opaque string             | Scope of event                                                                                                       |
| `eventType`                                              | closed enum               | Pairing created/claimed/confirmed/denied/expired; device revoked; auth failed; connection; operation accepted/result |
| `operationType` / `resultCode`                           | closed enum or absent     | Metadata only                                                                                                        |
| `connectionGeneration` / cursor                          | optional bounded metadata | Diagnostics without content                                                                                          |

Audit data must not contain prompt/output text, interaction answers, paths, QR payload/secret, credentials, proofs, keys, ciphertext body, decrypted invalid frames, or arbitrary exceptions.

## 14. Stable Error Codes

The wire contract uses stable machine codes; the phone maps them to `en-US`/`zh-CN` copy.

```text
authentication_failed
protocol_version_mismatch
device_not_paired
device_revoked
scope_denied
machine_offline
machine_lease_changed
operation_expired
operation_id_conflict
operation_not_found
entity_revision_conflict
interaction_not_pending
interaction_expired
cursor_expired
cursor_gap
epoch_changed
snapshot_required
payload_too_large
rate_limited
slow_consumer
invalid_frame
internal
```

Error details use a small error-specific closed schema and remain under 4 KiB total. They never contain a raw Runtime error, request body, stack trace, or sensitive identifier not already visible to the authorized principal.
