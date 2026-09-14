# Data Model: Direct Paired Mobile Access

## Ownership Summary

| Entity                     | Authority                                     | Desktop persisted view                           | Mobile persisted view                               |
| -------------------------- | --------------------------------------------- | ------------------------------------------------ | --------------------------------------------------- |
| Computer installation      | Desktop Electron main                         | Full identity/configuration                      | Verified identity projection                        |
| Listener configuration     | Desktop Electron main                         | Selected addresses, port, enabled/revision       | Display-only last observed endpoint state           |
| Connection endpoint        | User-approved profile / desktop advertisement | Eligible advertised endpoints                    | Approved endpoint candidates and priority           |
| Pairing invitation         | Desktop direct gateway                        | Verifier, attempts, state, expiry                | Ephemeral scanned/entered material only             |
| Paired phone authorization | Desktop direct gateway                        | Phone public keys, scope, revision, revoke state | Own device/key references and authorization receipt |
| Connection profile         | Mobile app                                    | None                                             | Computer identity, endpoints, freshness, protocol   |
| Remote session projection  | Desktop Runtime                               | Source session                                   | Bounded cached session and conversation view        |
| Remote operation           | Desktop operation ledger                      | Intent/result                                    | Pending/result correlation and draft state          |

There is no Account, OIDC credential, Relay lease, central device registry, central machine record, push registration, or central notification entity in the target model.

## Computer Installation

Stable local authorization root for one Workbench desktop installation.

| Field                  | Type                 | Rules                                                                                            |
| ---------------------- | -------------------- | ------------------------------------------------------------------------------------------------ |
| `machineId`            | opaque string        | Locally generated once; 128-bit randomness or stronger; never derived from hostname/path/account |
| `displayName`          | string               | 1–128 UTF-8 bytes; user-editable locally                                                         |
| `encryptionKeyId`      | opaque string        | Stable key version identifier                                                                    |
| `encryptionPublicKey`  | encoded public key   | P-256 HPKE-compatible public key                                                                 |
| `encryptionPrivateKey` | secret key/reference | Electron `safeStorage` only; never renderer/mobile/log/QR plaintext beyond public counterpart    |
| `fingerprint`          | string               | Canonical SHA-256 fingerprint of the public key                                                  |
| `createdAt`            | timestamp            | UTC                                                                                              |

The desktop identity survives listener disable/enable and address changes. Explicit “reset remote identity” revokes every phone and requires new pairing.

## Listener Configuration

| Field                | Type          | Rules                                                               |
| -------------------- | ------------- | ------------------------------------------------------------------- |
| `enabled`            | boolean       | Defaults `false`                                                    |
| `port`               | integer       | 1–65535; default 8787; UI warns for privileged ranges               |
| `selectedInterfaces` | array         | 0–8 entries containing canonical interface ID plus selected address |
| `revision`           | opaque string | Changes for every committed update                                  |
| `updatedAt`          | timestamp     | UTC                                                                 |

State transitions:

```text
disabled
  -> starting
  -> listening

starting/listening
  -> failed (no eligible address, bind conflict, invalid config)

listening
  -> replacing (candidate generation binds all endpoints)
  -> listening (candidate becomes current; old generation closes)
  -> listening (candidate fails; old generation remains)
  -> stopping -> disabled
```

## Connection Endpoint

| Field             | Type                         | Rules                                                                   |
| ----------------- | ---------------------------- | ----------------------------------------------------------------------- |
| `endpointId`      | opaque string                | Stable within one profile/config revision                               |
| `kind`            | `local-network \| tailscale` | User-facing classification; not an authentication claim                 |
| `host`            | canonical string             | Eligible private/Tailscale literal or accepted local/Tailscale hostname |
| `port`            | integer                      | 1–65535                                                                 |
| `addressFamily`   | `ipv4 \| ipv6 \| hostname`   | Derived/canonicalized                                                   |
| `interfaceId`     | optional string              | Desktop-only interface correlation                                      |
| `priority`        | integer                      | Unique ordering within profile                                          |
| `approvedAt`      | timestamp                    | Required for a stored mobile candidate                                  |
| `lastSucceededAt` | optional timestamp           | Never changes trust identity                                            |

The serialized socket URL is derived, never accepted as arbitrary user text. It always uses the fixed `/remote/v1/direct` path and carries no credential/query/fragment.

## Pairing Invitation

| Field                | Type            | Rules                                                                                     |
| -------------------- | --------------- | ----------------------------------------------------------------------------------------- |
| `pairingId`          | opaque string   | At least 128-bit unpredictable identity                                                   |
| `secretVerifier`     | digest/verifier | Desktop stores no recoverable one-time secret after presentation                          |
| `manualCodeVerifier` | digest/verifier | Corresponds to a human-entered code with at least 40 bits of entropy                      |
| `offeredEndpoints`   | array           | 1–8 current selected endpoints                                                            |
| `desktopIdentity`    | public identity | Machine ID, encryption key ID/public key/fingerprint                                      |
| `protocolRange`      | `{min,max}`     | Closed supported versions                                                                 |
| `createdAt`          | timestamp       | UTC                                                                                       |
| `expiresAt`          | timestamp       | Default and maximum two minutes                                                           |
| `attemptsRemaining`  | integer         | Starts at 5; atomically decremented on failed secret proof                                |
| `state`              | enum            | `created`, `claimed`, `confirmed`, `denied`, `expired`, `locked`, `consumed`, `cancelled` |
| `claim`              | optional claim  | Bounded phone public identity and transcript digest only                                  |

Only `created` accepts one claim. `claimed` waits for local desktop confirmation. All terminal states reject claims and confirmation. Successful confirmation atomically creates one Paired Phone Authorization and consumes the invitation.

## Paired Phone Authorization

| Field                      | Type               | Rules                                                                      |
| -------------------------- | ------------------ | -------------------------------------------------------------------------- |
| `deviceId`                 | opaque string      | Locally generated by phone; unique per desktop installation                |
| `displayName`              | string             | 1–128 UTF-8 bytes                                                          |
| `platform`                 | `ios \| android`   | Display metadata only                                                      |
| `signingPublicKey`         | public key         | Verifies direct connection challenges                                      |
| `signingKeyFingerprint`    | string             | Bound in pairing transcript                                                |
| `encryptionKeyId`          | opaque string      | Current HPKE key version                                                   |
| `encryptionPublicKey`      | public key         | Desktop encrypts results/events to phone                                   |
| `encryptionKeyFingerprint` | string             | Bound in pairing transcript                                                |
| `scope`                    | closed set         | Exactly multi-session read/create/send/stop/organize/ordinary-answer       |
| `revision`                 | opaque string      | Included in connection auth and changed on update/revoke                   |
| `createdAt`                | timestamp          | UTC                                                                        |
| `lastSeenAt`               | optional timestamp | Metadata only                                                              |
| `revokedAt`                | optional timestamp | Once set, authorization cannot be restored; re-pair creates a new identity |

No private phone key, account ID, bearer credential, Tailscale identity, IP allowlist, prompt, message, or tool data is stored here.

## Connection Profile

Mobile-owned local projection of one paired computer.

| Field                        | Type               | Rules                                                                                                                                     |
| ---------------------------- | ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `machineId`                  | opaque string      | Primary identity key                                                                                                                      |
| `displayName`                | string             | Last desktop-authoritative bounded value                                                                                                  |
| `desktopEncryptionKeyId`     | opaque string      | Pinned key version                                                                                                                        |
| `desktopEncryptionPublicKey` | public key         | Used for HPKE/authentication                                                                                                              |
| `desktopFingerprint`         | string             | Must match before any data/mutation                                                                                                       |
| `deviceId`                   | opaque string      | Phone identity for this computer                                                                                                          |
| `authorizationRevision`      | opaque string      | Checked at connection setup                                                                                                               |
| `endpoints`                  | 1–8 endpoint array | Explicitly approved and ordered                                                                                                           |
| `preferredEndpointId`        | opaque string      | Must reference endpoints                                                                                                                  |
| `protocolRange`              | `{min,max}`        | Last approved range                                                                                                                       |
| `connectionState`            | enum               | `offline`, `connecting`, `pairing`, `synchronizing`, `ready`, `reconnecting`, `suspended`, `incompatible`, `identity-mismatch`, `revoked` |
| `lastSeenAt`                 | optional timestamp | Freshness display                                                                                                                         |

Private signing/encryption keys are referenced from SecureStore by `(machineId, deviceId, keyId)` and do not enter SQLite.

## Direct Connection Challenge

| Field                | Type               | Rules                                                         |
| -------------------- | ------------------ | ------------------------------------------------------------- |
| `connectionId`       | opaque string      | Fresh per accepted socket                                     |
| `nonce`              | encoded bytes      | At least 256 random bits; one use; expires after five seconds |
| `machineId`          | opaque string      | Gateway identity                                              |
| `desktopFingerprint` | string             | Must equal profile pin before authentication                  |
| `protocolRange`      | `{min,max}`        | Gateway offer                                                 |
| `endpoint`           | canonical endpoint | Binds the actual listener/address to the signed transcript    |
| `expiresAt`          | timestamp          | At most five seconds after issue                              |

The phone signs a canonical transcript including the challenge, its device ID and authorization revision, negotiated protocol, cursor, and unresolved operation IDs. The gateway accepts it once, then erases it.

## Remote Session Projection and Operation

The Spec 013 bounded session/conversation/operation models remain authoritative after removing `accountId` and Relay-routing fields. The conversation item union is extended with assistant tool-call transcripts and tool results: tool name, canonical JSON arguments, original textual output, error state, and explicit truncation state. Hidden reasoning, binary/image output, tool-result details, provider exceptions, unknown host events, and executable tool controls are excluded. The desktop ledger key becomes `(machineId, deviceId, operationId)`. It retains canonical command hash, accepted time, state, result/error, and applied cursor. Incomplete operations are never evicted solely for capacity; terminal entries are retained at least seven days and within the most recent 10,000.

## Deletion and Reset Semantics

- **Disable remote access**: stop listeners and active connections; retain installation identity, paired phones, and mobile profiles so re-enable can reconnect.
- **Revoke one phone**: persist revocation, increment authorization revision, close matching connections, and reject later challenges/requests.
- **Remove one mobile profile**: clear that computer's mobile keys, authorization receipt, cached sessions/conversations, drafts, cursors, and pending operations; does not alter desktop authorization until desktop sees a signed revoke request or the local user revokes it.
- **Reset desktop remote identity**: stop listeners, revoke/erase all phone authorizations and invitations, replace desktop identity keys, and require fresh pairing for every phone.
- **App uninstall/reinstall**: the existing installation sentinel clears surviving mobile secure keys when SQLite state is absent and requires re-pairing.
