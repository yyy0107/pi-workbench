# Feature Specification: Workbench Mobile Remote Control

> **Superseded topology notice (2026-09-13)**: The account/OIDC/central-Relay access model in this completed design is retained as historical implementation evidence. The user subsequently selected account-free direct access over the same local network or Tailscale. That replacement is specified by [Spec 014](../014-direct-paired-access/spec.md); do not use this document as the target connection/identity architecture.

**Feature Branch**: `013-mobile-remote-control`

**Created**: 2026-09-13

**Status**: Draft

**Input**: User description: "Develop a Workbench phone client that remotely controls the computer client, supports multi-session management, and does not include the toolbox or other desktop work surfaces."

## User Scenarios & Testing _(mandatory)_

### User Story 1 - Pair and inspect desktop sessions (Priority: P1)

A Workbench user pairs the phone with an authorized computer, sees whether that computer is reachable, and opens a current list of its non-archived sessions without exposing the computer directly to the public network.

**Why this priority**: Pairing and session discovery establish the trusted remote-control boundary and are prerequisites for every useful mobile action.

**Independent Test**: Pair one phone with one running desktop instance, confirm that the phone displays the computer and its sessions, then revoke the phone and confirm that subsequent access is denied.

**Acceptance Scenarios**:

1. **Given** a signed-in user and a desktop displaying a valid one-time pairing challenge, **When** the user scans and confirms the challenge on both devices, **Then** the phone is registered as a distinct revocable device and can view that desktop's sessions.
2. **Given** a paired desktop that is online, **When** the user opens the mobile client, **Then** the user sees the desktop's connection status and session summaries ordered by recent activity.
3. **Given** a previously paired desktop that is offline, **When** the user opens the mobile client, **Then** the client shows the last known session summaries as stale, identifies when the desktop was last reachable, and disables remote mutations.
4. **Given** a revoked or expired mobile device credential, **When** the phone attempts to read desktop sessions, **Then** access is denied without revealing session content.

---

### User Story 2 - Follow and control a session remotely (Priority: P1)

A paired user opens a desktop-hosted session on the phone, reads its conversation, sends a new message, and stops an active run when necessary. The computer remains the sole executor and source of truth.

**Why this priority**: Reading a conversation, sending the next message, and stopping a run are the primary value of a remote Workbench companion.

**Independent Test**: Open one existing session, send a message from the phone, observe the corresponding desktop session start and stream progress, then stop that run from the phone and verify both devices converge on the stopped state.

**Acceptance Scenarios**:

1. **Given** an online paired desktop and an existing session, **When** the user opens that session on the phone, **Then** the client displays the ordered user and assistant conversation together with its current running, completed, waiting, stopped, or failed status.
2. **Given** an idle session, **When** the user sends a non-empty message from the phone, **Then** the message is accepted once, the desktop starts the corresponding run, and both devices identify the same session and run.
3. **Given** an active run, **When** the user requests stop from the phone, **Then** the desktop receives one stop request and both devices eventually display the resulting terminal state.
4. **Given** a session waiting for ordinary user input, **When** the user answers from the phone, **Then** the answer is delivered once and the session resumes on the desktop.
5. **Given** a tool execution or other desktop-only content in the conversation, **When** the phone renders the conversation, **Then** it shows a bounded status summary without exposing an interactive toolbox, terminal, file browser, or raw oversized tool result.

---

### User Story 3 - Manage multiple sessions (Priority: P2)

A user creates and organizes several desktop-hosted sessions from the phone so that active work can be found and resumed quickly.

**Why this priority**: Multi-session organization is the requested product boundary, but it depends on trusted pairing and basic session control.

**Independent Test**: From the phone, create two sessions, rename and pin one, archive the other, and confirm the same organization appears on the desktop after synchronization.

**Acceptance Scenarios**:

1. **Given** an online paired desktop, **When** the user creates a session from the phone, **Then** the desktop creates exactly one session and the phone opens it when its identity is confirmed.
2. **Given** multiple visible sessions, **When** the user switches among them, **Then** each session preserves its own conversation, draft text, unread state, and execution status.
3. **Given** an existing session, **When** the user renames, pins, unpins, or archives it from the phone, **Then** the mutation is reflected on the desktop and remains correct after reconnecting.
4. **Given** an archived session, **When** the user views active sessions, **Then** the archived session is excluded; restoring and deleting archived sessions remain desktop-only in the first release.

---

### User Story 4 - Receive actionable session notifications (Priority: P2)

A paired user receives a privacy-preserving phone notification when a remote session completes, fails, or needs ordinary user input, and can open the exact session from that notification.

**Why this priority**: Remote control is most valuable when the user can leave the desk and be brought back only when attention is needed.

**Independent Test**: Put the mobile client in the background, complete a run and trigger a waiting-for-input state on the desktop, then verify that each meaningful transition generates at most one notification and opens the correct session.

**Acceptance Scenarios**:

1. **Given** notifications are authorized and the mobile client is not active, **When** a session transitions to completed, failed, or waiting for input, **Then** the user receives at most one notification for that transition.
2. **Given** a session notification, **When** the user taps it, **Then** the client opens the associated computer and session and refreshes its current state.
3. **Given** a notification displayed on a locked device, **When** message previews are not explicitly enabled, **Then** the notification contains no prompts, generated content, code, file paths, tool output, or credentials.
4. **Given** several streaming updates that do not require attention, **When** the app is in the background, **Then** those updates do not generate individual notifications.

---

### User Story 5 - Recover safely from network changes (Priority: P3)

A user moves between Wi-Fi, cellular data, background suspension, and temporary disconnection without duplicating remote commands or losing the authoritative session state.

**Why this priority**: Mobile connectivity is intermittent; safe recovery is required before the experience is dependable, but the core flows can first be demonstrated on a stable connection.

**Independent Test**: Interrupt connectivity immediately after sending a message, restore connectivity, and confirm the message is neither lost after acknowledgement nor submitted twice and that the phone converges to the desktop's current state.

**Acceptance Scenarios**:

1. **Given** a phone that last observed a known session revision, **When** it reconnects, **Then** it receives missing changes or an authoritative replacement snapshot before enabling new mutations.
2. **Given** a mutation whose outcome is unknown because the connection dropped, **When** the client retries with the same operation identity, **Then** the desktop applies the mutation no more than once and returns the original result when available.
3. **Given** the phone is offline before a new mutation is submitted, **When** the user attempts to send or manage a session, **Then** the client keeps local draft text but does not silently queue the mutation for later execution.
4. **Given** cached session content, **When** the desktop or remote service is unavailable, **Then** cached content is explicitly marked stale and is not presented as current execution state.

### Edge Cases

- A pairing challenge expires, is scanned twice, belongs to another signed-in account, or is denied on the desktop.
- The same account pairs several phones or computers, and one device is revoked without invalidating the others.
- The computer sleeps, shuts down, loses its network, changes networks, or reconnects with a new process instance.
- A phone loses connectivity after sending a mutation but before receiving its acknowledgement.
- Mobile and desktop clients support incompatible remote protocol versions.
- A session is archived, renamed, or stopped on the desktop while its previous state is open on the phone.
- A session emits updates faster than the phone can render or reconnect with them.
- Conversation history or one tool result is too large for a single mobile response.
- The operating system delays or coalesces background notifications.
- The user denies notification, camera, or biometric permission; core foreground control remains usable with an alternate pairing-code entry path.
- The phone is lost while it still has a valid pairing; the desktop or account owner can revoke that phone independently.

## Requirements _(mandatory)_

### Functional Requirements

- **FR-001**: The system MUST let an authenticated user pair a phone with a desktop using a short-lived, single-use challenge that requires confirmation and does not contain a reusable desktop runtime credential.
- **FR-002**: The system MUST represent each paired phone as an independently identifiable and revocable device.
- **FR-003**: The system MUST let a paired phone determine whether each authorized desktop is online, offline, reconnecting, or incompatible, including the last known connection time when it is offline.
- **FR-004**: The system MUST let a paired phone list authorized desktop sessions with identity, title, recent-activity time, pinned and archived state, unread-attention state, and current execution status.
- **FR-005**: The system MUST let a paired phone open a session and retrieve bounded, ordered conversation history without loading an unbounded history or oversized raw result into one response.
- **FR-006**: The system MUST let a paired phone create a desktop-hosted session and MUST NOT run an agent locally on the phone.
- **FR-007**: The system MUST let a paired phone send a text message to an idle or input-waiting session and receive an explicit accepted, rejected, or outcome-unknown result.
- **FR-008**: The system MUST let a paired phone request that an active desktop-hosted run stop and show the authoritative resulting state.
- **FR-009**: The system MUST let a paired phone rename, pin, unpin, and archive an authorized session.
- **FR-010**: The system MUST preserve separate draft text, read position, unread state, and visible execution state when the user switches between sessions.
- **FR-011**: The system MUST stream session changes while the mobile client is active and MUST restore continuity from a known revision or replace local state with an authoritative snapshot after a gap.
- **FR-012**: Every remotely submitted mutation MUST have a stable operation identity and MUST be applied no more than once when delivery or acknowledgement is retried.
- **FR-013**: The mobile client MUST NOT silently queue remote mutations while offline; it MUST preserve unsent draft text and require an explicit retry after connectivity is restored.
- **FR-014**: The system MUST notify opted-in users when a session completes, fails, or needs ordinary user input, while suppressing notifications for routine streaming progress.
- **FR-015**: A notification MUST identify its target computer and session for navigation but MUST exclude conversation text, generated content, code, paths, tool output, and credentials unless the user explicitly enables message previews.
- **FR-016**: The mobile client MUST display cached data as stale whenever it cannot establish that the data reflects the current desktop state.
- **FR-017**: The remote-control surface MUST expose only explicitly approved session-management and conversation operations; terminal access, file access, browser control, arbitrary tool invocation, extension management, provider/model configuration, and raw desktop runtime access MUST be unavailable.
- **FR-018**: Tool activity included in conversation history MUST be reduced to a bounded, non-interactive status summary on mobile; security-sensitive tool approval remains desktop-only in the first release.
- **FR-019**: The system MUST encrypt all remote traffic, authorize every read and mutation against the account, computer, paired device, and allowed operation, and keep mobile credentials separate from local desktop renderer credentials.
- **FR-020**: The system MUST support independent sign-out and revocation from both the mobile account and the desktop's paired-device management surface.
- **FR-021**: The system MUST reject incompatible protocol versions before accepting session content or mutations and MUST give the user an actionable upgrade message.
- **FR-022**: The system MUST record security-relevant events, including pairing, revocation, authentication failure, and remote mutation outcome, without recording credentials or unrestricted conversation content.
- **FR-023**: All new or modified user-visible copy MUST be available in `en-US` and `zh-CN`, with `en-US` as the final fallback.
- **FR-024**: The mobile experience MUST support an alternate manual pairing-code path when camera permission is unavailable and remain functional in the foreground when notification or biometric permission is denied.

### Scope Exclusions

- Running an agent, runtime, extension host, or model provider on the phone.
- Mobile terminal, file tree, editor, diff/review, browser, toolbox, extension management, automation management, or complete settings surfaces.
- Interactive rendering of arbitrary desktop tools or unrestricted tool result payloads.
- Remote approval of security-sensitive tool permission requests in the first release.
- Restoring or permanently deleting archived sessions from the phone in the first release.
- Treating the phone cache or remote routing service as the authoritative session store.

### Key Entities

- **Account**: The authenticated owner boundary used to authorize computers and mobile devices.
- **Desktop Device**: A Workbench installation that hosts the authoritative runtime and sessions and reports its presence and protocol compatibility.
- **Mobile Device**: A distinct paired phone with revocable credentials, notification preference, and last activity information.
- **Pairing Challenge**: A short-lived, single-use request that binds an authenticated mobile device to an authorized desktop after confirmation.
- **Remote Session Summary**: The bounded list representation of a desktop-hosted session, including organization, attention, activity, and execution state.
- **Remote Conversation Page**: An ordered, bounded slice of display-safe conversation items with pagination or continuation information.
- **Remote Operation**: An idempotently identified request to create, message, stop, rename, pin, unpin, or archive a session together with its acceptance and outcome.
- **Remote Event**: A versioned, ordered state change used to advance the phone from one known desktop revision to the next.
- **Notification Registration**: The association between a mobile device and its current delivery token and privacy preferences.
- **Security Event**: A credential-free record of pairing, revocation, authentication failure, or remote-operation outcome.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: At least 90% of first-time users can pair a phone with an available desktop and open its session list within two minutes without assistance.
- **SC-002**: Under normal connectivity, 95% of foreground session-list and conversation openings show current usable content within two seconds.
- **SC-003**: Under normal connectivity, 95% of accepted mobile messages and stop requests become visible on both devices within two seconds.
- **SC-004**: Across forced disconnect-and-retry validation, no accepted remote mutation is applied more than once and all clients converge to the desktop's authoritative state within five seconds of reconnection.
- **SC-005**: A phone can browse and switch among at least 200 session summaries without losing per-session draft or unread state and without an interaction pause longer than one second under the reference device profile.
- **SC-006**: At least 95% of eligible completion, failure, and input-needed transitions generate no more than one user-visible notification and open the correct session when tapped; delivery delays imposed by the operating system are reported separately.
- **SC-007**: Security validation finds zero routes by which a paired mobile device can access terminal, files, browser, arbitrary tools, extensions, provider configuration, or local desktop credentials.
- **SC-008**: Revoking a phone prevents all new reads and mutations from that device within one minute while leaving other authorized devices usable.
- **SC-009**: Every new user-visible mobile string has matching `en-US` and `zh-CN` coverage, and missing base-locale entries fail validation.

## Assumptions

- The first release targets authenticated individual Workbench users rather than shared team workspaces or delegated administrators.
- One account may pair multiple computers and phones, but each session remains owned and authored by one desktop runtime.
- The desktop application is installed, running, signed in, and permitted to maintain an outbound network connection when remote control is expected.
- The mobile client is a thin companion and never becomes the source of truth for session history or execution state.
- Cached conversation data is used only for fast display and disconnected read-only access; authoritative state remains on the desktop.
- Ordinary conversation input can be answered remotely, while security-sensitive tool permissions stay on the desktop in the first release.
- Background delivery is advisory because mobile operating systems may delay or coalesce notifications; foreground refresh establishes the authoritative state.
- The service may route encrypted session data, but durable storage of unrestricted conversation content outside the desktop is not required for the first release.

## Dependencies

- A desktop-side remote-control adapter that translates a strict whitelist of remote operations into existing authoritative session services.
- An account, device-pairing, presence, event-routing, and notification-delivery service reachable by both phone and desktop.
- Existing Workbench session contracts and behaviors for creating, reading, messaging, stopping, renaming, pinning, and archiving sessions.
- Apple and Android notification infrastructure and valid application-distribution credentials for production notification delivery.

## Workbench 项目约定

遵循 `.specify/memory/constitution.md`：库包根 `packages/<领域>/<能力>`，src 为真实能力实现/契约/装配，lib 为内部辅助源码，两处均最多一级子目录；src 不得全为转导出。能力与辅助源码均保留 TS/TSX，不改写为 JS，tests/ 为库包测试目录；使用 pnpm。能力迁移任务必须包含前置任务、来源/目标、消费者、验证与完成条件；只在验证后勾选。
