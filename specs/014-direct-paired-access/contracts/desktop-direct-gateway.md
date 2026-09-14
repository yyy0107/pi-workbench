# Contract: Desktop Direct Gateway

**Reusable network owner**: `@workbench/remote-control-direct-server`<br>
**Business bridge owner**: `@workbench/pi-runtime-remote-control`<br>
**Composition owner**: `apps/desktop-electron` main process

## 1. Boundary

The direct gateway is the only non-loopback listener added by this feature. It accepts a closed direct pairing/authentication/WebSocket protocol, resolves a locally persisted paired-phone authorization, and passes authenticated sealed business frames to the existing Pi remote frame processor. It never exposes or forwards the local Runtime origin, Runtime credential, renderer IPC, arbitrary HTTP, raw Pi RPC, StreamHub, AgentSession, filesystem, Toolbox, Terminal, model/provider, or extension capability. The Pi projection may return bounded read-only assistant/tool transcript data inside authenticated HPKE responses; this does not add an executable gateway method.

## 2. Direct-Server Ports

```ts
interface DirectNetworkInterfacePort {
  list(): Promise<DirectInterfaceAddress[]>;
}

interface DirectListenerPort {
  prepare(input: {
    addresses: DirectInterfaceAddress[];
    port: number;
    path: "/remote/v1/direct";
    onSocket(socket: DirectSocketPort, localEndpoint: DirectEndpointV1): void;
  }): Promise<PreparedListenerGeneration>;
}

interface DirectInstallationStorePort {
  loadInstallation(): Promise<DesktopInstallationIdentity | undefined>;
  saveInstallation(value: DesktopInstallationIdentity): Promise<void>;
  loadConfiguration(): Promise<DirectListenerConfiguration>;
  saveConfiguration(value: DirectListenerConfiguration): Promise<void>;
  listAuthorizations(): Promise<PairedPhoneAuthorization[]>;
  replaceAuthorizations(value: PairedPhoneAuthorization[]): Promise<void>;
}

interface DirectPairingApprovalPort {
  publishClaim(value: {
    pairingId: string;
    deviceId: string;
    deviceDisplayName: string;
    platform: "ios" | "android";
    safetyCode: string;
    expiresAt: string;
  }): void;
}

interface DirectBusinessFramePort {
  process(input: {
    connectionId: string;
    authorization: PairedPhoneAuthorization;
    envelope: RemoteSealedEnvelopeV1;
  }): Promise<readonly RemoteSealedEnvelopeV1[]>;
  subscribe(
    authorization: PairedPhoneAuthorization,
    send: (frame: RemoteSealedEnvelopeV1) => Promise<void>,
  ): Disposable;
}
```

`PreparedListenerGeneration.commit()` atomically makes all successfully bound listeners current and closes the previous generation. `dispose()` closes only the candidate. A partial bind never silently narrows the user's selected interface set.

## 3. Lifecycle

```text
Electron loads encrypted installation/config/authorizations
  -> remote disabled: no listener
  -> remote enabled + RuntimeConnection available:
       enumerate interfaces
       validate exact selected addresses
       prepare all listeners
       create one Pi bridge generation
       commit listener generation

configuration changes
  -> prepare complete replacement
  -> success: commit replacement, close old sockets/listeners
  -> failure: dispose candidate, retain old healthy generation, report error

RuntimeConnection changes
  -> stop admitting business frames
  -> dispose Pi frame subscriptions/old epoch
  -> build next Pi bridge generation using same direct listeners or atomically restart
  -> require client resynchronization

disable/quit
  -> stop admissions, close sockets, listeners, timers, pairing invitations, and Pi subscriptions
  -> retain installation identity/paired authorizations unless explicit reset/revoke
```

All cleanup paths are idempotent. Repeated enable/start calls do not create duplicate listeners or Pi observers.

## 4. Electron Renderer Contract

Renderer/preload expose only bounded local methods:

```ts
interface RemoteAccessSettingsApi {
  describe(): Promise<RemoteAccessSettingsView>;
  listInterfaces(): Promise<DirectInterfaceView[]>;
  updateConfiguration(input: {
    enabled: boolean;
    port: number;
    selectedInterfaceIds: string[];
    expectedRevision: string;
  }): Promise<RemoteAccessSettingsView>;
  createPairing(): Promise<DesktopPairingView>;
  getPairing(pairingId: string): Promise<DesktopPairingView>;
  confirmPairing(pairingId: string, safetyCode: string): Promise<void>;
  rejectPairing(pairingId: string): Promise<void>;
  cancelPairing(pairingId: string): Promise<void>;
  listDevices(): Promise<RemoteDeviceView[]>;
  revokeDevice(deviceId: string, expectedRevision: string): Promise<void>;
  resetIdentity(confirmation: string): Promise<void>;
}
```

The view may include enabled/listener status, configured port, selected/eligible interface display metadata, candidate direct endpoints, pairing QR/manual presentation material, phone display metadata, safety code, expiry, and stable localized error codes. It must not return desktop or phone private keys, stored public-key bytes, pairing verifier/proof, active challenge, ciphertext, Runtime origin/token, local path, or internal stack/error.

## 5. Persistence

- Encrypt the installation identity, paired-phone authorization set, and remote listener configuration through Electron `safeStorage` using the existing mode-0600 document owner.
- Persist a new authorization/revocation/config revision before reporting success or closing sockets.
- Never store live pairing secrets beyond their short invitation lifetime; store verifiers in memory and invalidate them on gateway restart.
- Continue using the existing dedicated SQLite operation ledger for remote mutation durability; do not merge it into renderer settings storage.

## 6. Pi Boundary

The direct gateway receives a `DirectBusinessFramePort` from the current `@workbench/pi-runtime-remote-control` bridge. That bridge continues to use the installed repository's public `@workbench/pi-rpc-client/api` and current Runtime connection. It neither imports the Pi SDK into the gateway nor starts another Runtime/session registry.

Per-request authorization is performed both before decryption at the direct gateway and again inside the business frame processor. Defense in depth must check current revision/revocation rather than trust a connection-time snapshot indefinitely.

## 7. Required Non-UI Tests

- Address/interface classification for RFC1918, CGNAT/Tailscale, ULA, public, wildcard, multicast, loopback, and link-local cases.
- Exact listener preparation, all-or-nothing replacement, conflict/error reporting, connection limits, timeouts, backpressure, and cleanup.
- QR and manual pairing success plus expiry, attempt exhaustion, denial, duplicate/race, key substitution/safety-code mismatch, and restart invalidation.
- Fresh challenge proof, replay, stale revision, unknown/revoked device, version mismatch, identity mismatch, and business-before-auth rejection.
- Persist-before-visible configuration and authorization/revocation behavior, including storage failure.
- Runtime restart changes epoch without creating another Pi service; disable/quit closes ingress.
- Renderer IPC and copy boundary exclude keys, secrets, ciphertext, Runtime credentials, local paths, and raw errors.
- Packaged Electron artifact contains the `ws` server and the complete direct gateway/Pi bridge closure.
