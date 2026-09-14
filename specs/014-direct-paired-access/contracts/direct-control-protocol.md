# Contract: Direct Remote Control Protocol v1

**Status**: Design contract; executable types/codecs belong to `@workbench/remote-control-contracts`<br>
**Trust boundary**: Workbench Remote phone ↔ Electron direct gateway<br>
**Network boundary**: Mutually reachable local-network or Tailscale endpoint only

## 1. Ingress Rules

- Fixed socket path: `/remote/v1/direct`.
- The URL contains only scheme, canonical host, port, and fixed path. It contains no invitation, code, token, device ID, key, cursor, operation ID, query, credentials, or fragment.
- The gateway supports a closed pre-authentication frame union and a closed authenticated frame union. Unknown types, extra security fields, malformed UTF-8/JSON, excessive nesting, invalid encodings, or byte-budget violations close the connection generically.
- First frame must complete within five seconds. Pre-authentication frames are at most 16 KiB and at most five are accepted for a pairing connection. Sealed business frames are at most 256 KiB ciphertext unless a lower message-specific bound applies.
- `perMessageDeflate` is disabled. Sustained send backlog above 1 MiB for ten seconds closes the socket.
- Identifiers are opaque printable strings at most 128 bytes; timestamps are UTC RFC 3339; cursor offsets are decimal uint64 strings.

## 2. Direct Pairing Payload

```ts
interface DirectPairingPayloadV1 {
  type: "workbench.remote.direct-pairing";
  version: 1;
  pairingId: string;
  pairingSecret: string; // QR bootstrap only; one use
  manualCode: string; // manual fallback only; one use, >=40 bits entropy
  machineId: string;
  machineDisplayName: string;
  endpoints: DirectEndpointV1[]; // 1..8
  desktopEncryptionKeyId: string;
  desktopEncryptionPublicKey: string;
  desktopEncryptionKeyFingerprint: string;
  protocolRange: { min: 1; max: 1 };
  expiresAt: string;
}

interface DirectEndpointV1 {
  kind: "local-network" | "tailscale";
  host: string;
  port: number;
}
```

The QR representation contains the complete typed object. The manual UI collects one host, port, and `manualCode`; after connecting, it receives the remaining public pairing hello from that gateway. Neither representation contains a reusable phone authorization or desktop private key.

## 3. Pairing Frames

Server public hello, bounded and content-free:

```ts
interface DirectPairingHelloV1 {
  type: "direct.pairing.hello";
  version: 1;
  pairingId: string;
  machineId: string;
  machineDisplayName: string;
  endpoint: DirectEndpointV1;
  desktopEncryptionKeyId: string;
  desktopEncryptionPublicKey: string;
  desktopEncryptionKeyFingerprint: string;
  protocolRange: { min: 1; max: 1 };
  expiresAt: string;
}
```

The phone sends a `RemoteSealedEnvelopeV1` encrypted to the offered/pinned desktop key. Its plaintext is exactly:

```ts
interface DirectPairingClaimV1 {
  type: "direct.pairing.claim";
  pairingId: string;
  secretProof: string;
  deviceId: string;
  deviceDisplayName: string;
  platform: "ios" | "android";
  mobileSigningPublicJwk: JsonWebKey;
  mobileSigningKeyFingerprint: string;
  mobileEncryptionKeyId: string;
  mobileEncryptionPublicKey: string;
  mobileEncryptionKeyFingerprint: string;
  transcriptProof: string;
}
```

The canonical transcript binds pairing ID, secret proof, machine ID, exact endpoint, both device identities/keys/fingerprints, protocol version, and expiry. Both sides derive the same six-digit display safety code from its digest. The desktop renderer receives only phone display metadata, safety code, expiry, and pairing ID; it never receives private keys or secret proof.

Desktop confirmation yields an HPKE-sealed result to the phone:

```ts
type DirectPairingResultV1 =
  | {
      type: "direct.pairing.result";
      pairingId: string;
      state: "confirmed";
      deviceId: string;
      authorizationRevision: string;
      scope: RemoteAction[];
      desktopIdentity: DirectDesktopIdentityV1;
      approvedEndpoints: DirectEndpointV1[];
    }
  | {
      type: "direct.pairing.result";
      pairingId: string;
      state: "denied" | "expired" | "locked";
      code: RemoteErrorCodeV1;
    };
```

## 4. Authenticated Connection Setup

Gateway challenge:

```ts
interface DirectSocketChallengeV1 {
  type: "direct.socket.challenge";
  version: 1;
  connectionId: string;
  nonce: string;
  machineId: string;
  desktopEncryptionKeyId: string;
  desktopEncryptionKeyFingerprint: string;
  endpoint: DirectEndpointV1;
  protocolRange: { min: 1; max: 1 };
  expiresAt: string;
}
```

Phone response:

```ts
interface DirectSocketAuthenticateV1 {
  type: "direct.socket.authenticate";
  version: 1;
  connectionId: string;
  deviceId: string;
  authorizationRevision: string;
  protocolRange: { min: 1; max: 1 };
  resume: {
    cursor?: RemoteCursor;
    unresolvedOperationIds: string[];
  };
  challengeProof: string;
}
```

The signature transcript includes every field above and the gateway endpoint. The gateway derives identity from its local paired-phone authorization; the payload cannot assert scope. It rejects an unknown/revoked device, stale authorization revision, reused/expired challenge, signature mismatch, machine mismatch, endpoint mismatch, or non-overlapping version before accepting any business frame.

Gateway acknowledgement:

```ts
interface DirectSocketAuthenticatedV1 {
  type: "direct.socket.authenticated";
  version: 1;
  protocolVersion: 1;
  connectionId: string;
  machineId: string;
  deviceId: string;
  authorizationRevision: string;
  epoch: string;
}
```

## 5. Sealed Business Frames

The existing remote command, query, result, event, snapshot, and cursor unions remain closed. The direct envelope removes Relay routing principals:

```ts
interface RemoteSealedEnvelopeV1 {
  protocolVersion: 1;
  envelopeId: string;
  machineId: string;
  deviceId: string;
  direction: "mobile-to-desktop" | "desktop-to-mobile";
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

Every visible header field is canonical AEAD associated data. The gateway verifies `machineId`, `deviceId`, direction, key ID, expiry, unique envelope ID, and current authorization before decryption. The phone verifies the desktop key pin before decryption/projection.

## 6. Allowed Business Surface

Allowed actions remain exactly:

```ts
type RemoteAction =
  | "sessions.read"
  | "sessions.create"
  | "sessions.send"
  | "sessions.stop"
  | "sessions.organize"
  | "interactions.respond";
```

Allowed mutations remain session create, text send, stop, rename, set pinned, set archived, and answer an already-published ordinary question. Allowed queries remain session catalog, bounded conversation history, cursor recovery/snapshot, and operation status. Conversation history may contain read-only assistant text, tool-call names/canonical JSON arguments, and original textual tool outputs. The history page remains limited to 192 KiB/50 items; assistant text is limited to 96 KiB, aggregate arguments in one assistant item to 64 KiB, and one tool output to 128 KiB, all measured as UTF-8 bytes with explicit truncation state.

No inbound frame contains or selects an arbitrary URL, RPC method, path, cwd, file, attachment, terminal, browser, Git operation, tool invocation, tool approval, extension, model/provider setting, credential, environment variable, or raw Runtime event. Read-only outbound tool transcripts are conversation data, never executable requests; hidden reasoning, binary/image output, unrestricted errors, host events, and tool-result details are not projected.

## 7. Revocation and Close Semantics

- Desktop revocation persists a new authorization revision before closing every matching socket.
- Later authentication receives only a stable generic `device_revoked` result after proof identifies the device; pre-authentication close text contains no identity detail.
- Phone identity mismatch or desktop key mismatch closes locally without sending a business request.
- Listener disable closes all direct sockets with a bounded generic reason and does not delete authorizations.
- Desktop identity reset closes sockets, invalidates every invitation/authorization, replaces keys, and requires pairing.

## 8. Security Logging

Logs and persisted diagnostics may contain event kind, timestamp, machine-local device ID, listener generation ID, result code, and byte counts. They must not contain QR/manual code, pairing secret/proof, nonce, signature, private/public key bytes, HPKE `enc`/ciphertext, prompt/message/session title, local path, tool data, or decrypted frame content.
