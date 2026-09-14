# Feature Specification: Direct Paired Mobile Access

**Feature Branch**: `codex/package-refactor`

**Created**: 2026-09-13

**Status**: Draft

**Input**: User description: "Remove account login from Workbench mobile remote control. A phone connects directly to a computer that is reachable on the same local network or through Tailscale, using a host/IP and port or a scanned pairing QR code."

## User Scenarios & Testing _(mandatory)_

### User Story 1 - Pair Directly Without an Account (Priority: P1)

A user enables mobile remote control on a Workbench computer and pairs a phone without creating or signing in to a Workbench account. The phone can scan a short-lived QR code or enter the computer address, port, and one-time pairing code manually. Both devices show the same safety code, and the computer must approve the phone before access begins.

**Why this priority**: Direct, account-free pairing is the trust foundation for every other mobile operation and is the user's explicitly selected access model.

**Independent Test**: Enable remote access on one computer, pair a fresh phone over a reachable local or Tailscale address, confirm the safety code on the computer, and verify that the phone receives an independently revocable device authorization without contacting an identity or central relay service.

**Acceptance Scenarios**:

1. **Given** remote access is disabled, **When** the user opens the computer's remote-access settings, **Then** no network listener is active and the user can explicitly enable it.
2. **Given** remote access is enabled, **When** the computer generates a pairing QR code and the phone scans it before expiry, **Then** both devices display the same safety code and no access is granted until the computer approves the phone.
3. **Given** camera access is unavailable, **When** the user enters a reachable IP address or hostname, port, and valid one-time code, **Then** the same confirmation and authorization flow completes without an account login.
4. **Given** a pairing invitation is expired, reused, denied, or exceeds its attempt limit, **When** a phone submits it, **Then** access is rejected without revealing whether another device is already paired.
5. **Given** a phone has not been paired, **When** it reaches the computer's remote endpoint, **Then** it cannot list sessions, read conversations, or invoke any mutation.

---

### User Story 2 - Control Multiple Sessions Over LAN or Tailscale (Priority: P2)

A paired phone connects directly to the selected computer while the phone and computer are mutually reachable on the same local network or through Tailscale. The phone lists, opens, creates, sends text to, stops, renames, pins, and archives desktop-hosted sessions. The computer remains the only executor and source of truth.

**Why this priority**: Multi-session control is the product's primary value after direct trust has been established.

**Independent Test**: With one paired phone and one reachable computer, exercise every permitted read and mutation across at least two sessions, interrupt and restore connectivity, and verify that desktop state remains authoritative and each accepted operation takes effect at most once.

**Acceptance Scenarios**:

1. **Given** a paired phone can reach the computer, **When** the phone opens the computer, **Then** it sees bounded session summaries and their current execution states without an account or central service.
2. **Given** an authorized session, **When** the phone reads history or sends text, **Then** it receives ordered, bounded updates and the computer performs the operation at most once.
3. **Given** an active run, **When** the phone requests stop, **Then** the phone displays the computer's authoritative resulting state.
4. **Given** two sessions, **When** the user switches, drafts, or organizes one of them, **Then** draft, unread, pending-operation, and execution state remain isolated per session.
5. **Given** the connection drops after a mutation may have reached the computer, **When** connectivity returns, **Then** the phone reconciles the operation result and does not blindly send the mutation again.
6. **Given** the phone is in the background, **When** the operating system suspends it, **Then** the app does not claim continuous connectivity and resynchronizes when it becomes active again.
7. **Given** an authorized session contains assistant text and tool execution, **When** the phone opens or resumes the conversation, **Then** it shows every user-visible assistant message plus read-only tool names, arguments, and original textual outputs in desktop order, without requiring the user to switch to the computer.

---

### User Story 3 - Maintain Reachable Computer Profiles (Priority: P3)

A user can pair the phone with multiple computers, keep one or more reachable addresses for each computer, update an address after DHCP or Tailscale naming changes, and revoke a phone independently from each computer.

**Why this priority**: Direct networking requires understandable recovery when addresses change and clear local control over trusted devices.

**Independent Test**: Pair with two computers, change one computer's preferred address while preserving its verified identity, reconnect successfully, revoke the phone from one computer, and verify the other computer remains usable.

**Acceptance Scenarios**:

1. **Given** a paired computer has several advertised reachable addresses, **When** the preferred address fails, **Then** the phone may try only previously approved alternatives for the same verified computer identity.
2. **Given** a computer receives a new local IP or Tailscale address, **When** the user edits the connection profile and the presented computer identity matches the paired identity, **Then** the phone reconnects without requiring a new device authorization.
3. **Given** a presented identity does not match the paired computer, **When** the user edits or follows a changed endpoint, **Then** the app blocks access and requires an explicit new pairing.
4. **Given** a computer revokes one phone, **When** that phone next sends or maintains a connection, **Then** the connection closes and subsequent reads and mutations fail while other paired phones and computers remain unaffected.

### Edge Cases

- The computer has no reachable LAN or Tailscale address, or its firewall blocks the configured port.
- A hostname resolves to multiple IPv4/IPv6 addresses, including an address outside the enabled interface set.
- The computer changes between Ethernet, Wi-Fi, and Tailscale interfaces while an authorized phone is connected.
- Two phones attempt to consume the same one-time invitation concurrently.
- A local attacker guesses pairing codes, replays a pairing transcript, substitutes a computer key, or floods the pre-authentication endpoint.
- A stored connection profile contains an invalid, multicast, wildcard, loopback-only, link-local, or otherwise unusable address for the selected access mode.
- The phone reaches a different computer at a previously stored address after DHCP reassignment.
- The mobile app is suspended or killed during pairing or while an operation result is in flight.
- The desktop Runtime restarts while the direct gateway remains enabled.
- Tailscale is installed but disconnected, MagicDNS is unavailable, or the user enters a Tailscale name that cannot be resolved.

## Requirements _(mandatory)_

### Functional Requirements

- **FR-001**: The product MUST NOT require or present Workbench account registration, account login, OAuth/OIDC, access tokens, or refresh tokens for direct mobile remote control.
- **FR-002**: The computer MUST keep remote access disabled by default and MUST require an explicit local user action to enable a dedicated, limited remote-control endpoint.
- **FR-003**: The computer MUST let the user select a listening port and eligible local-network or Tailscale interfaces, and MUST display the addresses that a phone may use.
- **FR-004**: The product MUST NOT expose the desktop Runtime, unrestricted desktop APIs, or arbitrary internal RPC endpoints on the network; only the bounded remote-control capability may listen beyond loopback.
- **FR-005**: The computer MUST generate a short-lived, single-use pairing invitation that can be represented as a QR code and that contains no reusable device credential.
- **FR-006**: The phone MUST support a manual fallback using an IP address or hostname, port, and one-time pairing code when QR scanning is unavailable.
- **FR-007**: Pairing MUST bind the computer identity, phone identity, offered endpoint, protocol version, and expiry into a confirmation transcript and MUST require matching safety-code confirmation on the computer before authorization.
- **FR-008**: The system MUST rate-limit and bound unauthenticated pairing attempts, invalidate invitations after expiry, denial, successful consumption, or the configured attempt limit, and reject concurrent reuse atomically.
- **FR-009**: Each paired phone MUST receive a distinct cryptographic device identity and authorization that can be revoked independently without an account or shared long-lived password.
- **FR-010**: Every connection and every read or mutation MUST prove possession of the paired phone identity and MUST be checked against the target computer, allowed capability, current authorization revision, and revocation state.
- **FR-011**: All pairing and remote-control business content MUST be encrypted and integrity-protected end to end, and the phone MUST detect a computer identity mismatch before exposing session data or sending a mutation.
- **FR-012**: A phone MUST be able to store multiple computer connection profiles, each containing a verified computer identity and one or more explicitly approved LAN, Tailscale IP, or Tailscale hostname endpoints.
- **FR-013**: A user MUST be able to add, edit, prioritize, test, and remove connection endpoints without replacing the paired authorization when the verified computer identity remains unchanged.
- **FR-014**: The phone MUST NOT automatically follow an unapproved endpoint or accept a different computer identity at a stored address; an identity change requires a new explicit pairing.
- **FR-015**: When active and mutually reachable, a paired phone MUST be able to list, open, create, send text to, stop, rename, pin, unpin, and archive desktop-hosted sessions.
- **FR-016**: The computer MUST remain the sole executor and authoritative source for session identity, conversation order, execution state, organization state, and operation results.
- **FR-017**: The system MUST preserve bounded history, cursor-based resynchronization, snapshots, idempotent mutations, operation-result recovery, per-session drafts, and stale/offline presentation across connection loss.
- **FR-018**: The phone connection MUST be active only while the app is in the foreground, MUST stop reconnect and heartbeat work while suspended, and MUST resynchronize when foreground activity resumes.
- **FR-019**: The first release MUST require direct IP or hostname reachability on the same local network or through Tailscale and MUST NOT provide public discovery, NAT traversal, public port-forwarding guidance, or a mandatory central relay.
- **FR-020**: Tailscale support MUST use ordinary Tailscale IP or hostname reachability and MUST NOT require Workbench to access a user's Tailscale account, control plane, API, keys, or credentials.
- **FR-021**: The desktop MUST list paired phones with display name, authorization state, and last activity, and MUST let the local user revoke any phone immediately.
- **FR-022**: Revocation MUST close the affected active connection, reject later requests, clear the phone's usable authorization on reconciliation, and leave unrelated paired phones and computers unaffected.
- **FR-023**: The mobile capability MUST NOT expose Toolbox, terminal, files, browser control, extensions, model/provider settings, arbitrary tools, sensitive approvals, unrestricted host events, or raw Runtime/Pi RPC.
- **FR-024**: User-visible mobile and desktop text, validation, errors, permission explanations, and accessibility labels MUST be available in both `en-US` and `zh-CN`, with user-entered hosts, ports, IDs, session content, and errors from the computer preserved rather than translated.
- **FR-025**: The first release MUST operate without a central identity database, central device registry, central session database, central notification service, or internet deployment owned by Workbench.
- **FR-026**: Because the first release has no always-reachable service, it MUST NOT promise background completion notifications while the phone cannot directly reach the computer; foreground synchronization remains fully usable.
- **FR-027**: The authorized conversation projection MUST include every user-visible assistant text message and read-only tool transcript (tool name, JSON arguments, textual output, success/failure, and source truncation state) in authoritative desktop order; content within the per-field limits MUST be preserved verbatim, while oversized UTF-8 content MUST carry an explicit truncation state.
- **FR-028**: Read-only tool transcripts MUST travel only inside the authenticated, end-to-end encrypted business channel and MAY be cached with the same local protections as other conversation content. They MUST NOT add any remote tool invocation, approval, terminal, file-browser, raw RPC, hidden model reasoning, binary/image output, unrestricted provider error, unknown host event, log, diagnostic, or notification-content path.

### Key Entities

- **Computer Installation**: One Workbench desktop installation with a stable, locally generated identity, remote-access enabled state, eligible network interfaces, listening port, and authoritative sessions.
- **Connection Endpoint**: An explicitly approved IP address or hostname plus port and access kind (`local-network` or `tailscale`) associated with one verified computer identity.
- **Connection Profile**: The phone's local record of a paired computer, verified identity fingerprint, approved endpoints, preferred endpoint, protocol range, freshness, and cached session projection.
- **Pairing Invitation**: A short-lived, single-use bootstrap challenge with a computer identity, offered endpoints, one-time secret/verifier, protocol range, expiry, attempt state, and confirmation state.
- **Paired Phone**: A distinct phone identity authorized by one computer with a display name, public verification/encryption keys, allowed multi-session capability, revision, last activity, and revocation state.
- **Remote Session Projection**: A bounded phone-safe representation of a desktop-hosted session and its ordered user-visible conversation state, including read-only assistant text, tool-call inputs, and textual tool outputs.
- **Remote Operation**: An idempotent request and authoritative result for one allowed session read or mutation.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: At least 90% of first-time users can enable remote access, pair by QR, approve the safety code, and open the session list within two minutes without an account or external service.
- **SC-002**: A user who cannot scan a QR code can complete manual IP/hostname, port, and one-time-code pairing within three minutes without assistance.
- **SC-003**: On a healthy local or Tailscale connection, at least 95% of session-list and conversation openings show current desktop state within two seconds.
- **SC-004**: On a healthy local or Tailscale connection, at least 95% of accepted send, stop, and organize actions show authoritative resulting state within two seconds.
- **SC-005**: After a connection interruption, the phone converges to desktop state within five seconds of restored reachability and no accepted mutation takes effect more than once.
- **SC-006**: A stored profile that reaches a different computer identity exposes zero session data and performs zero mutations until the user completes a new pairing.
- **SC-007**: Revoking one phone terminates its active access within five seconds and does not interrupt any unrelated paired device.
- **SC-008**: Security and boundary validation finds zero routes by which a paired phone can access excluded Toolbox, terminal, file, browser, extension, provider, model, arbitrary tool, approval, or unrestricted Runtime capabilities.
- **SC-009**: The complete direct-access flow succeeds with no account provider, central Relay, central database, or Workbench-owned internet service available.
- **SC-010**: Both base locales pass key/interpolation parity and every new user-visible state has accessible text; stable identifiers and user content remain unchanged.
- **SC-011**: Projection fixtures preserve ordinary assistant text, tool arguments, and textual tool outputs byte-for-byte, mark oversized multi-byte content without introducing invalid Unicode, and expose zero hidden reasoning or unrestricted host/provider events.

## Assumptions

- The phone and computer already have direct IP reachability through the same trusted local network or through a separately installed and configured Tailscale network.
- Workbench does not install, configure, authenticate to, or manage Tailscale; a Tailscale IP or MagicDNS name is treated like any other directly reachable address.
- Public internet discovery, NAT traversal, port forwarding, and a hosted fallback Relay are outside the first-release scope.
- The operating system or firewall may require the local user to approve incoming connections when remote access is enabled.
- Direct reachability does not guarantee continuous mobile background execution; the first release synchronizes when the app is active and does not promise remote push delivery.
- A phone may pair with multiple computers, and a computer may pair with multiple phones, without a shared account namespace.
- Existing multi-session projection, encryption, idempotency, replay, snapshot, and bounded-output work should be reused where it still matches the account-free direct trust model.
- A paired phone is an authorized conversation viewer. Tool transcripts can contain the same sensitive project content visible in the desktop conversation, so users must revoke a lost or untrusted phone.

## Workbench 项目约定

遵循 `.specify/memory/constitution.md`：库包根 `packages/<领域>/<能力>`，src 为真实能力实现/契约/装配，lib 为内部辅助源码，两处均最多一级子目录；src 不得全为转导出。能力与辅助源码均保留 TS/TSX，不改写为 JS，tests/ 为库包测试目录；使用 pnpm。能力迁移任务必须包含前置任务、来源/目标、消费者、验证与完成条件；只在验证后勾选。
