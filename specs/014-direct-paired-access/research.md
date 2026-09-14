# Research: Direct Paired Mobile Access

## Decision 1 — Direct reachability is the only first-release network model

**Decision**: A phone connects to a dedicated desktop gateway using an explicitly approved local-network or Tailscale IP/hostname and port. There is no Workbench account, hosted discovery, NAT traversal, mandatory Relay, or public port-forwarding workflow.

**Rationale**: This matches the user's stated boundary and removes identity-provider, hosted database, deployment, and central-availability dependencies from a personal remote-control product. Tailscale already supplies cross-network addressing and encrypted routing without requiring Workbench to manage a VPN.

**Alternatives considered**:

- Keep the account-based Relay: rejected because it adds login and hosted infrastructure the user does not want.
- Public IP/port forwarding: rejected as a default because NAT/CGNAT, dynamic addresses, router configuration, and attack exposure conflict with the intended simple/safe flow.
- Workbench-managed Tailscale integration: rejected because direct Tailscale addresses already work and Workbench must not request control-plane credentials.

## Decision 2 — A dedicated Electron gateway, not the Runtime listener

**Decision**: Electron main starts a distinct direct remote gateway and connects it internally to the current authenticated loopback Runtime connection through public Pi client APIs.

**Rationale**: The Runtime boundary deliberately assumes loopback plus desktop-side authentication and includes Toolbox/file/model/provider surfaces that are forbidden remotely. A closed gateway preserves the small command/projection contract and prevents any raw RPC proxy.

**Alternatives considered**:

- Bind the current Runtime host to LAN/Tailscale: rejected because trusted-host settings are not authentication and the Runtime surface is much broader than mobile scope.
- Run a second Pi service for remote access: rejected because it would create competing session ownership and lifecycle.
- Put network ingress in the renderer: rejected because renderer compromise and lifecycle are the wrong trust boundary for credentials/listeners.

## Decision 3 — Exact selected-interface listeners

**Decision**: Remote access is disabled by default. When enabled, Electron enumerates non-internal interfaces and starts one listener per explicitly selected eligible address on one configured port. It does not default to `0.0.0.0` or `::`.

**Rationale**: Exact binding makes the user-visible access scope truthful and avoids unintentionally exposing the gateway through public, container, virtual, or newly added interfaces. Listener restarts are atomic: a complete candidate generation must bind successfully before it replaces the previous generation.

**Alternatives considered**:

- Bind all interfaces and filter source IPs: rejected because source classification is brittle and still exposes the port on unintended interfaces.
- Automatically bind every private-looking interface: rejected because Docker/VM/VPN interfaces can be private-looking without being user intended.
- Automatic network discovery: deferred; QR and manual address entry already satisfy the product and avoid multicast/background permission complexity.

## Decision 4 — Private/Tailscale endpoint grammar

**Decision**: Accept RFC1918 IPv4, `100.64.0.0/10` Tailscale/CGNAT IPv4, IPv6 ULA, single-label hostnames, `.local`, and `.ts.net` names. Reject schemes in manual host input, credentials, paths, queries, fragments, wildcard, multicast, unspecified, link-local, and arbitrary public FQDN endpoints. Port range is 1–65535 with a non-privileged default of 8787.

**Rationale**: The grammar covers ordinary home/office LANs and Tailscale IP/MagicDNS while making “not public internet” machine-testable. Identity pinning still protects against DNS or DHCP reassignment.

**Alternatives considered**:

- Any hostname: rejected because it silently broadens the product into public-internet access.
- Tailscale interface-name detection: rejected because interface names differ by OS and are not an authentication signal.
- Only IP literals: rejected because `.local` and Tailscale MagicDNS materially improve resilience to address changes.

## Decision 5 — Application HPKE over `ws://` for first release

**Decision**: Use direct WebSocket with strict application-layer HPKE for all sensitive pairing and business payloads. The phone pins the desktop key obtained from QR or confirmed manual transcript. Android enables cleartext transport through the supported Expo build-properties plugin. iOS declares local-network usage, enables `NSAllowsLocalNetworking` for IP/unqualified/local endpoints, and grants a narrow `ts.net` subdomain exception for approved Tailscale MagicDNS names. Tailscale also encrypts its path.

**Rationale**: LAN IPs normally lack publicly trusted certificates, while Expo/React Native's standard WebSocket interface does not expose a portable self-signed certificate pinning contract. Requiring certificate installation would make pairing substantially harder. HPKE already interoperates between the installed Node and React Native runtimes and provides confidentiality/integrity independent of transport.

**Residual risk**: An observer can see network metadata and can delay/drop traffic. A manual-pairing active attacker can substitute the offered key only by causing a different safety code; desktop confirmation is mandatory. These limits are stated in the UI/quickstart and do not weaken business payload encryption.

**Alternatives considered**:

- Self-signed `wss://`: rejected for MVP because portable native pinning would require another native networking module and platform-specific lifecycle.
- Plain JSON over `ws://`: rejected because LAN/Tailscale placement does not replace application authentication or protect content on ordinary LANs.
- TLS-only: rejected because endpoint certificates alone do not provide independently revocable phone identity or protect through a future opaque transport.

## Decision 6 — One WebSocket protocol for pairing and control

**Decision**: The gateway accepts only WebSocket upgrades on one fixed path. Before authorization it permits a small closed set of hello/pairing/authentication frames under tight byte, attempt, connection, and timeout limits. After authorization it permits only sealed business frames and heartbeat/close control.

**Rationale**: A single bounded ingress avoids building a general LAN HTTP API, keeps credentials out of URLs, and permits one lifecycle and backpressure policy. Existing command/result/event/snapshot HPKE codecs remain reusable.

**Alternatives considered**:

- HTTP pairing plus WebSocket control: rejected because it creates more exposed routes and duplicated authentication/error policies.
- Put one-time code in a URL: rejected because URLs leak through logs, diagnostics, and copied history.

## Decision 7 — Device-key identity replaces accounts

**Decision**: The desktop installation is the authorization root. Each phone generates signing and encryption keys and receives one computer-local authorization. Every connection signs a fresh challenge, and every decrypted request is checked against machine ID, device ID, capability set, authorization revision, and revocation state.

**Rationale**: This provides strong, independently revocable authentication without username/password, bearer tokens, refresh tokens, or a central namespace. One phone can pair with several computers as separate profiles.

**Alternatives considered**:

- Reusable pairing password: rejected because compromise affects every future connection and makes independent revocation difficult.
- IP allowlist only: rejected because addresses are not stable identities and DHCP can reassign them.
- Tailscale identity headers: rejected because the standard direct socket does not receive a portable authenticated Tailscale user/device assertion and the app should not depend on the control plane.

## Decision 8 — Local persistence and endpoint identity

**Decision**: Electron `safeStorage` persists the desktop private identity, selected listener configuration, and paired-phone public authorizations. Mobile SecureStore persists phone private identities/authorization secrets; SQLite persists non-secret connection profiles, endpoint candidates, bounded projections, drafts, cursors, and pending operation records.

**Rationale**: These stores already exist in the product and keep private key material out of renderer and SQLite. An endpoint edit is accepted only when the live desktop proves the profile's pinned identity.

**Alternatives considered**:

- Store paired devices only in memory: rejected because authorization/revocation must survive restart.
- Store private keys in mobile SQLite: rejected because SecureStore is the existing secret boundary.
- Derive identity from IP/hostname: rejected because DHCP and DNS names change and can be reassigned.

## Decision 9 — No background push promise

**Decision**: Remove account/Relay notification registration and content-free push intents from the first-release product. The active mobile app maintains/reconnects the direct socket; background/inactive states close it and mark data stale until foreground sync.

**Rationale**: APNs/FCM delivery needs an internet-reachable provider service. A LAN/Tailscale-only desktop cannot reliably notify a suspended phone through ordinary app networking. Retaining the UI would falsely imply a service guarantee outside the chosen topology.

**Alternatives considered**:

- Keep the old Relay only for notifications: rejected because it reintroduces identity, hosted availability, device registration, and privacy surface.
- Permanent background socket: rejected because iOS suspension and Android Doze make it unreliable and energy-inefficient.

## Decision 10 — Reuse the narrow Pi adapter

**Decision**: Keep `@workbench/pi-runtime-remote-control` as the only translation from direct remote commands to the existing public `@workbench/pi-rpc-client/api` against the current Runtime connection. No Pi SDK, session object, StreamHub, or raw RPC type crosses the remote boundary.

**Rationale**: The current adapter already implements the desired allowlist, hostile-data projection, operation idempotency, event replay, and Runtime-generation fencing. Only account/Relay identifiers and lifecycle ports need replacement.

**Installed API verification**: Workbench resolves `@earendil-works/pi-coding-agent` 0.85.1 through its package root. This feature does not add a new Pi SDK import; it uses the repository's existing public Pi RPC client facade as required by `packages/pi-runtime/integration.md`.

## Decision 11 — Remove rather than hide the central topology

**Decision**: Rename the reusable server package to `@workbench/remote-control-direct-server`, replace its contents with direct gateway responsibilities, remove `apps/remote-control-relay`, and remove OIDC/PostgreSQL/push dependencies and scripts after the direct closed loop is passing.

**Rationale**: Leaving dormant account/Relay code in the first-release product graph makes configuration and ownership ambiguous and risks accidental reactivation. Spec 013 remains historical design evidence; Spec 014 owns the superseding implementation.

**Alternatives considered**:

- Keep Relay as an undocumented fallback: rejected because it violates the explicit no-central-service requirement.
- Delete all Spec 013 protocol/bridge work and restart: rejected because its business projection, encryption, idempotency, and recovery behavior remain valuable and validated.

## Decision 12 — Project read-only tool transcripts

**Decision**: Treat a paired phone as an authorized viewer of the desktop conversation. The bounded history union carries every user-visible assistant text block, tool-call name and canonical JSON arguments, and original textual tool result. Bash history is represented as a read-only tool result with its command and output. Ordinary content is preserved; an explicit flag identifies source or remote UTF-8 truncation.

**Rationale**: Replacing tool events with a generic desktop-only placeholder makes the mobile conversation incomplete and forces the user back to the computer. These fields already belong to the authoritative conversation and remain inside the mutually authenticated HPKE channel. Keeping them as projection data rather than commands preserves the narrow execution boundary.

**Safety boundary**: Hidden thinking/reasoning, binary/image results, attachment payloads, provider exceptions/stacks, unknown host events, approval payloads, and tool-result `details` remain excluded. No inbound operation can select, invoke, or approve a tool. Transcripts may contain sensitive project data and are cached like other conversation content, so device revocation remains the containment mechanism for a lost phone.

**Installed API verification**: The projection matches the installed `@earendil-works/pi-coding-agent` 0.85.1 public message shapes: assistant content contains text/thinking/tool-call parts, tool results contain text/image content plus bounded metadata, and bash execution exposes command/output/truncation state. No SDK deep import or new Runtime dependency is introduced.
