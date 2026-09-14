# Contract: Mobile Direct Client

**Composition owner**: `apps/mobile`<br>
**Reusable state owner**: `@workbench/remote-control-client`

## 1. Dependency Boundary

The reusable client owns endpoint/profile validation, direct connection state, challenge/authentication transitions, ordered frame reduction, reconnect/backoff, cursor/snapshot recovery, operations, and bounded session projections. The Expo app owns camera/manual input, WebSocket, AppState/network adapters, SecureStore, SQLite, routes, native local-network permission behavior, and user-visible state.

The mobile product must not depend on OIDC/OAuth, a Relay server/client, PostgreSQL, push registration, desktop Shell/UI, Pi Runtime/Pi client, agent Runtime client, Electron, Toolbox, local Runtime contracts, or private/deep package paths.

## 2. Installation and Boot

There is no signed-in/signed-out state. On boot:

1. Open SQLite and reconcile the installation sentinel with SecureStore.
2. Load zero or more connection profiles.
3. Show an empty “Add computer” state or the paired computer list immediately.
4. For profiles while the app is active and network is available, connect in priority order using approved endpoints.
5. Present cached session projections as stale until direct authentication and replay/snapshot synchronize them.

App states are:

```text
booting
  -> ready-empty
  -> ready-with-profiles
  -> configuration-error

per profile:
offline -> connecting -> authenticating -> synchronizing -> ready
ready/connecting -> reconnecting
any active state -> suspended
any -> incompatible | identity-mismatch | revoked
```

Only a synchronized `ready` profile accepts mutations. Offline drafts are retained but never auto-sent.

## 3. Connection Profile Ports

```ts
interface MobileConnectionProfileStorePort {
  listProfiles(): Promise<ConnectionProfile[]>;
  saveProfile(value: ConnectionProfile): Promise<void>;
  updateEndpoints(input: ProfileEndpointUpdate): Promise<ConnectionProfile>;
  removeProfile(machineId: string): Promise<void>;
}

interface MobileDirectCredentialPort {
  loadPhoneIdentity(machineId: string): Promise<PhonePrivateIdentity | undefined>;
  savePhoneIdentity(machineId: string, value: PhonePrivateIdentity): Promise<void>;
  deletePhoneIdentity(machineId: string): Promise<void>;
  loadAuthorization(machineId: string): Promise<DirectAuthorizationReceipt | undefined>;
  saveAuthorization(machineId: string, value: DirectAuthorizationReceipt): Promise<void>;
}

interface MobileDirectSocketPort {
  connect(endpoint: DirectEndpointV1): DirectSocket;
}
```

Private keys and authorization secret material stay in SecureStore. SQLite stores the desktop public identity/fingerprint, endpoint candidates, non-secret authorization revision, bounded projection, drafts, cursors, and pending operation IDs.

## 4. QR and Manual Pairing

- QR input strictly decodes `DirectPairingPayloadV1`, validates expiry/size/endpoint grammar, and pins the included desktop key before opening a socket.
- Manual input accepts separate host, port, and one-time code. The client derives the fixed direct socket URL and accepts only `direct.pairing.hello` before building the transcript.
- The phone generates independent signing and HPKE keys for each computer profile. A key is persisted only after the claim is prepared; failure/cancel cleans any unreferenced material.
- Both paths show the derived six-digit safety code and wait for desktop confirmation. The phone never self-confirms.
- On confirmed encrypted result, save SecureStore identity/authorization before committing the SQLite profile. A partial failure must not display the computer as usable.

## 5. Endpoint Selection and Identity Pinning

- Preserve user priority. Try the preferred endpoint first and only then other explicitly approved candidates.
- At most one active/reconnecting generation exists per profile.
- Before sending device authentication, compare `machineId`, desktop key ID, and desktop fingerprint from the challenge with the stored profile. Mismatch transitions to `identity-mismatch`, closes the socket, disables automatic retries for that endpoint, and exposes no cached content as current.
- Editing an endpoint performs a non-mutating identity probe. Save it only when the gateway proves the same desktop identity; otherwise require new pairing.
- Do not infer trust from IP range, hostname, Tailscale presence, or a previously successful DNS result.

## 6. Active Lifecycle and Recovery

- Connect/reconnect only while AppState is active and network is available.
- On inactive/background, cancel timers and pairing, close every direct socket best-effort, and mark projections stale.
- On foreground/network recovery, one immediate reconnect is permitted, followed by full-jitter backoff.
- Serialize incoming HPKE decrypt/validate/project work per socket generation so WebSocket arrival order is preserved.
- Authenticate with the last cursor and unresolved operation IDs; accept replay only for exact-next offsets in the same epoch, otherwise replace through an atomic snapshot.
- Unknown mutation outcomes query the same operation IDs. Never generate a replacement ID or auto-submit an offline draft.

## 7. Routes and Surface

```text
/
  Account-free paired computer list, connection state, add/edit/remove actions

/pair
  QR scan and manual host/port/one-time-code pairing

/machines/[machineId]/settings
  Approved endpoint order, add/test/edit/remove, identity and remove-profile action

/machines/[machineId]/sessions
  Bounded active session list and verified connection state

/machines/[machineId]/sessions/[sessionId]
  Bounded conversation with all visible assistant text and expandable read-only tool input/raw text output, plus text send, stop, and ordinary answer
```

There is no login/logout, notification registration, Toolbox, terminal, file browser, browser control, extension, automation, model/provider, tool invocation/approval, or general desktop settings surface. Tool transcripts are selectable conversation content only.

## 8. Platform Configuration

- Android production manifests allow direct cleartext local networking through `expo-build-properties` because the application protocol provides HPKE protection; no arbitrary URL navigation or HTTP fetch surface is exposed.
- iOS declares a localized local-network usage description, enables `NSAllowsLocalNetworking`, and limits its non-local ATS exception to `ts.net` subdomains for explicitly approved Tailscale MagicDNS names. No Bonjour service declaration is needed because v1 does not perform multicast discovery.
- Camera permission remains optional; manual pairing must be fully functional when denied.
- Camera configuration does not request microphone recording, and SecureStore configuration does not declare unused Face ID access.
- Tailscale requires no app permission, SDK, auth key, or account integration beyond ordinary socket reachability.

## 9. Required Non-UI Tests

- Boot with zero/multiple profiles and no remote environment variables.
- QR/manual parsing, endpoint grammar, expiry, safety transcript, cancellation, partial storage failure, and confirmed commit order.
- Preferred/fallback endpoint ordering, same-identity edit, identity mismatch, DNS/IP reassignment, and reconnect suppression.
- Direct challenge proof, stale revision, revoked/incompatible responses, ordered receive serialization, cursor/snapshot recovery, operation uncertainty, and per-session draft isolation.
- SecureStore/SQLite separation and complete profile removal; installation-sentinel cleanup.
- Dependency scan proves no auth-session, web-browser auth, notifications, Relay, desktop UI, Runtime/Pi, Toolbox, or deep imports.
- i18n key/interpolation parity and stable host/ID/content preservation.
- Expo dependency check, Doctor, production export, native crypto interoperability, and Android release compilation.

No UI/DOM/Hook render test or UI interaction smoke is added or run. QR comprehension, real local-network permission prompts, firewall behavior, Wi-Fi changes, Tailscale reachability, AppState/OS suspension, accessibility, and reference-device timing remain explicit release gates.
