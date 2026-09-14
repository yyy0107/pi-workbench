# Contract: Remote Control Protocol v1

**Status**: Design contract; implementation schemas belong to `@workbench/remote-control-contracts`<br>
**Trust boundary**: Mobile device ↔ Remote Relay ↔ paired desktop bridge

This contract is intentionally independent from local Runtime and Pi RPC contracts. It is a closed mobile projection, not a proxy protocol.

## 1. Protocol Rules

- Every HTTP body and WebSocket frame is versioned and strictly parsed; unknown discriminators, extra security-sensitive fields, invalid encodings, excessive depth, and excessive UTF-8 byte size are rejected.
- All network traffic uses HTTPS/WSS with TLS 1.3. Credentials never appear in URLs.
- Session-content commands, results, events, and snapshots use phone-to-desktop application-layer encryption. Relay-visible routing metadata is authenticated as AEAD associated data.
- Identifiers are opaque ASCII strings of at most 128 bytes. Timestamps are UTC RFC 3339. Cursor offsets are decimal uint64 strings.
- The Relay derives account/device/machine principals from authenticated connections. Payload `source` fields are never trusted as identity assertions.
- Wire errors contain a stable machine code and bounded typed details. User-facing messages are chosen by the client i18n layer.
- `operationId`, `eventId`, `hintId`, ticket, and invitation values use cryptographically random or UUIDv7-equivalent 128-bit uniqueness.

## 2. Version Negotiation

Both phone and desktop advertise an inclusive `{min, max}` range during authenticated connection setup. Relay selects the greatest mutually supported version. If no version overlaps, no sealed content or mutation is accepted; machine state becomes `incompatible` for that client and the client renders an upgrade action.

Version 1 is immutable after release. Additive or breaking wire behavior is introduced under a new negotiated protocol version; fields are not silently reinterpreted.

## 3. Relay HTTPS Surface

Endpoint names are descriptive; implementation may place them under a versioned prefix such as `/remote/v1`.

| Method and path                           | Principal                     | Request                                                                           | Response                                              | Notes                                                                                            |
| ----------------------------------------- | ----------------------------- | --------------------------------------------------------------------------------- | ----------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `POST /pairings`                          | Desktop machine               | Proposed protocol/key metadata                                                    | Invitation ID, expiry, QR/manual payload material     | Desktop-initiated; Relay stores secret verifier only                                             |
| `POST /pairings/{pairingId}/claim`        | Authenticated phone           | Transcript-bound proof and phone public keys                                      | `pending-desktop-confirmation` plus safety-code input | Same account required                                                                            |
| `POST /pairings/{pairingId}/confirm`      | Desktop machine               | Claim identity, transcript digest, decision                                       | Created authorization or terminal denial              | Atomically consumes invitation                                                                   |
| `GET /devices`                            | Account or desktop            | Pagination                                                                        | Bounded paired-device metadata                        | No credential/key private material                                                               |
| `POST /devices/{deviceId}/revoke`         | Account/desktop               | Expected revision                                                                 | Revocation result                                     | Invalidates tickets/connections/push registration                                                |
| `POST /mobile/socket-ticket`              | Authenticated phone           | Machine ID, protocol range, proof                                                 | Single-use ticket, challenge, expiry                  | About 30-second expiry                                                                           |
| `POST /desktop/socket-ticket`             | Authenticated machine         | Protocol range, proof                                                             | Single-use ticket, challenge, expiry                  | Separate machine credential                                                                      |
| `PUT /notifications/registration`         | Authenticated phone           | Provider token, environment, permission metadata                                  | Registration ID/revision                              | Token is secret and never echoed/logged                                                          |
| `DELETE /notifications/registration/{id}` | Authenticated phone           | Expected revision                                                                 | Revoked registration                                  | Idempotent                                                                                       |
| `POST /notifications/transition`          | Authenticated desktop machine | Opaque session ID, transition revision, closed completed/failed/input-needed kind | Bounded accepted/delivery count                       | Relay checks active mobile presence, authorization and registration; no title/body/error content |
| `GET /machines`                           | Authenticated phone           | Pagination                                                                        | Authorized machine metadata/presence only             | Session content comes over sealed desktop channel                                                |

Authentication uses system-browser OAuth Authorization Code + PKCE for the native app. WSS tickets are proof-bound, single-use, audience-specific, and too short-lived to be refresh credentials.

## 4. Pairing Payload

The QR/manual representation encodes a typed object, not an HTTPS query containing credentials:

```ts
interface PairingPayloadV1 {
  type: "workbench.remote.pairing";
  version: 1;
  relayOrigin: string; // HTTPS origin from an allowlisted deployment configuration
  pairingId: string;
  pairingSecret: string; // >= 256 random bits; erased after pairing attempt
  machineId: string;
  desktopEncryptionKeyId: string;
  desktopEncryptionPublicKey: string;
  desktopEncryptionKeyFingerprint: string;
  expiresAt: string;
}
```

The phone claim proves knowledge of `pairingSecret` and binds a canonical transcript containing the account, machine, phone identity, both long-term E2EE public keys/fingerprints, phone signing-key fingerprint, negotiated protocol, and expiry. The safety code is derived from that transcript and is never used as the secret itself.

## 5. WebSocket Authentication

The socket URL contains no token. The first client frame must arrive within five seconds and be no larger than 16 KiB:

```ts
interface SocketAuthenticateV1 {
  type: "socket.authenticate";
  version: 1;
  ticket: string;
  challengeProof: string;
  protocolRange: { min: 1; max: 1 };
  resume?: {
    cursor?: RemoteCursor;
    unresolvedOperationIds: string[];
  };
}
```

Relay atomically consumes the ticket, verifies proof/principal/device/machine/revocation, negotiates a version, and sends `socket.authenticated` before any business frame. Business frames sent before acknowledgement close the connection with a generic reason. Ticket, proof, token, and request body never enter close text or logs.

Desktop sockets receive a fenced `leaseGeneration`. Relay routes mobile commands only to the current generation.

## 6. Relay-Visible Sealed Envelope

```ts
interface RemoteSealedEnvelopeV1 {
  protocolVersion: 1;
  envelopeId: string;
  machineId: string;
  source: { kind: "mobile" | "desktop"; id: string };
  target: { kind: "mobile" | "desktop"; id: string };
  contentType: "command" | "result" | "event" | "snapshot-chunk";
  keyId: string;
  createdAt: string;
  expiresAt: string;
  hpke: {
    suite: "P256-HKDFSHA256-AES256GCM";
    enc: string;
    ciphertext: string;
  };
}
```

All visible header fields are included in AEAD associated data. Desktop authenticates a mobile ciphertext against the public key stored for the active paired-device authorization; Relay identity alone is insufficient. Key rotation changes `keyId`; retired keys have a bounded decrypt-only grace period.

## 7. Permissions and Commands

```ts
type RemoteAction =
  | "sessions.read"
  | "sessions.create"
  | "sessions.send"
  | "sessions.stop"
  | "sessions.organize"
  | "interactions.respond";

interface RemoteOperationRequestV1 {
  type: "operation.request";
  operationId: string;
  issuedAt: string;
  expiresAt: string;
  command: RemoteCommandV1;
}

type RemoteCommandV1 =
  | {
      type: "session.create";
      workspaceId?: string;
      title?: string;
    }
  | {
      type: "session.send";
      sessionId: string;
      text: string;
    }
  | {
      type: "session.stop";
      sessionId: string;
    }
  | {
      type: "session.rename";
      sessionId: string;
      title: string;
      expectedEntityRevision?: string;
    }
  | {
      type: "session.setPinned";
      sessionId: string;
      pinned: boolean;
      expectedEntityRevision?: string;
    }
  | {
      type: "session.setArchived";
      sessionId: string;
      archived: true;
      expectedEntityRevision?: string;
    }
  | {
      type: "interaction.answerQuestion";
      sessionId: string;
      interactionId: string;
      interactionRevision: string;
      answers: RemoteQuestionAnswerV1[];
    };
```

`session.setArchived` accepts only `true` in v1 because archive restoration is desktop-only. There is no delete, file, terminal, browser, Git, model, provider, settings, extension, toolbox, attachment, arbitrary composer, raw RPC, raw event, tool invocation, tool approval, or persistent-permission variant. Implementations use exhaustive switches; an unknown type is rejected, never forwarded.

`workspaceId` is an opaque ID from an authorized desktop projection. No request accepts `cwd`, path, URI, or environment variable. `session.send.text` is non-empty and at most 64 KiB UTF-8 after normalization.

Read and recovery traffic uses a separate closed request union inside a mobile-to-desktop
`contentType: "command"` envelope. These requests are queries, not mutations, and never enter the
operation ledger:

```ts
interface RemoteControlRequestV1 {
  type: "control.request";
  requestId: string;
  issuedAt: string;
  expiresAt: string;
  query:
    | { type: "session.catalog.read" }
    | { type: "conversation.history.read"; sessionId: string; historyCursor?: string }
    | { type: "sync.recover"; cursor?: RemoteCursor; unresolvedOperationIds: string[] }
    | { type: "operations.status"; operationIds: string[] };
}
```

The desktop returns a request-correlated sealed `control.response` containing exactly one of a
bounded session catalog, conversation page, replay batch, snapshot plan, operation-status result,
or stable error. A `sync.snapshot` response announces a `snapshotId`; the corresponding bounded
`snapshot.chunk` envelopes and `snapshot.complete` frame follow separately so a 200-session
snapshot never has to fit in one envelope. No control request contains an arbitrary method,
payload, RPC, path, or tool surface. Relay routes the envelope without decrypting this union.

## 8. Operation Result

```ts
type RemoteOperationStateV1 = "accepted" | "succeeded" | "rejected" | "expired";

interface RemoteOperationResultV1 {
  type: "operation.result";
  operationId: string;
  state: RemoteOperationStateV1;
  code?: RemoteErrorCodeV1;
  value?:
    | { type: "session-created"; sessionId: string }
    | { type: "message-accepted"; sessionId: string; messageId: string }
    | { type: "session-state"; sessionId: string; entityRevision: string }
    | { type: "interaction-resolved"; interactionId: string };
  appliedCursor?: RemoteCursor;
}
```

Relay delivery acknowledgement is distinct and means only that the sealed payload was routed/accepted for routing. Only a desktop-authenticated sealed operation result reports authoritative acceptance or outcome.

The desktop ledger key is `(machineId, deviceId, operationId)`. Same ID and canonical command digest returns the stored state/result; same ID with a different digest returns `operation_id_conflict`. Mobile uses the same identity after a timeout. There is no claim of exactly-once network delivery.

## 9. Read Projection

### Session Summary

```ts
interface RemoteSessionSummaryV1 {
  sessionId: string;
  workspace?: { workspaceId: string; displayName: string };
  title: string;
  updatedAt: string;
  pinned: boolean;
  archived: boolean;
  attention: "none" | "unread" | "input-needed" | "failed";
  runState:
    | "idle"
    | "queued"
    | "running"
    | "waiting-for-input"
    | "stopping"
    | "completed"
    | "stopped"
    | "failed";
  entityRevision: string;
}
```

Machine/session catalog responses have at most 200 items and 192 KiB plaintext. List order is pinned first and then descending recent activity, with stable ID as the final tie-breaker.

### Conversation Page

```ts
interface RemoteConversationPageV1 {
  sessionId: string;
  items: RemoteConversationItemV1[];
  historyCursor: string;
  nextCursor?: string;
  sessionRevision: string;
  projectionCursor: RemoteCursor;
}
```

A page contains no more than 50 items and 192 KiB. The item union contains only user text, assistant text, bounded activity summary, ordinary question, and closed system status. Activity summary is at most 2 KiB and never carries tool arguments/results, local paths, arbitrary renderer payloads, or executable actions.

## 10. Synchronization Frames

```ts
interface RemoteCursor {
  epoch: string;
  offset: string; // decimal uint64
}

type RemoteEventPayloadV1 =
  | { type: "machine.presenceChanged" /* bounded presence fields */ }
  | { type: "session.upserted"; session: RemoteSessionSummaryV1 }
  | { type: "session.removed"; sessionId: string }
  | { type: "session.runChanged"; sessionId: string; runState: RemoteSessionSummaryV1["runState"] }
  | { type: "session.messageAppended"; sessionId: string; item: RemoteConversationItemV1 }
  | {
      type: "session.messageDelta";
      sessionId: string;
      streamId: string;
      revision: string;
      delta: string;
    }
  | { type: "interaction.upserted"; interaction: RemoteOrdinaryQuestionV1 }
  | { type: "interaction.resolved"; interactionId: string }
  | RemoteOperationResultV1;

interface RemoteEventV1 {
  type: "sync.event";
  eventId: string;
  cursor: RemoteCursor;
  createdAt: string;
  payload: RemoteEventPayloadV1;
}
```

Desktop retains replay for at most 10,000 events, 10 MiB, or 15 minutes, whichever is reached first. Exact-next cursor events apply; duplicates are ignored; a gap, different epoch, evicted cursor, or projection reset stops event application and requests a snapshot.

Snapshot protocol sends bounded `snapshot-chunk` frames followed by `snapshot.complete` with `baseCursor`. Desktop buffers events newer than `baseCursor` while serializing. If the bootstrap buffer reaches 10,000 events or 10 MiB, desktop aborts with `snapshot_required`. Mobile commits the complete snapshot and base cursor in one SQLite transaction before applying buffered events.

## 11. Notification Hint

```ts
interface RemotePushHintV1 {
  version: 1;
  hintId: string;
  machineId: string;
  sessionId?: string;
  kind: "attention" | "state-changed";
}
```

The payload contains no title, content preview, code, paths, tool metadata, errors, answer, key, credential, or sealed session body. Duplicate/out-of-order hints only set a local `needsSync` flag. Notification tap opens the opaque route target and performs authoritative synchronization.

The desktop sends only `{ sessionId, transitionRevision, kind }` to the authenticated notification-transition endpoint. Relay—not the desktop—determines whether a mobile socket for the same account and machine is active, rechecks the device authorization and notification registration, suppresses active-app delivery, and maps the transition to the generic push hint. The transition endpoint rejects unknown or extra fields so Runtime content cannot be smuggled into push payloads.

## 12. Stable Error Codes

```ts
type RemoteErrorCodeV1 =
  | "authentication_failed"
  | "protocol_version_mismatch"
  | "device_not_paired"
  | "device_revoked"
  | "scope_denied"
  | "machine_offline"
  | "machine_lease_changed"
  | "operation_expired"
  | "operation_id_conflict"
  | "operation_not_found"
  | "entity_revision_conflict"
  | "interaction_not_pending"
  | "interaction_expired"
  | "cursor_expired"
  | "cursor_gap"
  | "epoch_changed"
  | "snapshot_required"
  | "payload_too_large"
  | "rate_limited"
  | "slow_consumer"
  | "invalid_frame"
  | "internal";
```

Error detail is a closed, code-specific object and no larger than 4 KiB. `internal` has no raw exception detail.

## 13. Resource Limits

| Resource                            |                 Limit |
| ----------------------------------- | --------------------: |
| Auth frame                          |                16 KiB |
| Sealed envelope                     |               256 KiB |
| Command plaintext                   |               128 KiB |
| Text prompt                         |                64 KiB |
| Title                               |             512 bytes |
| Identifier                          |       128 ASCII bytes |
| Activity summary                    |                 2 KiB |
| Question count/options per question |                 32/32 |
| Answer aggregate                    |                16 KiB |
| Catalog page                        | 100 items and 192 KiB |
| History page                        |  50 items and 192 KiB |
| Delta chunk                         |                16 KiB |
| JSON depth                          |                    16 |
| Pending socket bytes                |                 1 MiB |
| Backpressure grace                  |            10 seconds |

Limits apply to aggregate textual output and are measured in UTF-8 bytes. Structured data is rejected or paginated as a whole; it is never cut into invalid JSON. WebSocket per-message compression is disabled.

## 14. Required Contract Tests

- Reject unknown/extra fields, invalid discriminators, incompatible versions, excessive depth, invalid cursor numbers, and every size limit using ASCII, Chinese, emoji, multiline, and long-single-line fixtures.
- Prove there is no parser variant for terminal, files, browser, tools, approvals, extensions, models, settings, attachments, arbitrary Pi RPC, or archive restore/delete.
- Prove routing header/ciphertext/key ID tampering and wrong sender/recipient keys fail.
- Prove pairing expiry, reuse, competing claim, wrong account, denial, and transcript substitution fail closed.
- Prove socket ticket expiry/reuse, authentication timeout, pre-auth business frames, revoked device, wrong audience/scope, and stale desktop lease fail.
- Prove replay duplicate/gap/epoch/snapshot rules and bounded bootstrap behavior.
- Prove operation same-ID/same-digest replay and same-ID/different-digest conflict.
- Search Relay logs, fixtures, push payloads, and errors for forbidden prompt/title/path/answer/credential material.
