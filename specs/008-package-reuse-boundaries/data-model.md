# Data model and ownership

- **BrowserHost**: command(BrowserCommand, signal?, controlSignal?) -> Promise<unknown>; optional resolveProjectId(cwd). Runtime-free authoring contract, browser implementation stays in browser-server/pi-browser composition.
- **WorkspaceFileReader**: readFile(existing workspace request, signal?) -> existing workspace snapshot. Path/auth/version behavior stays in WorkspaceFileService.
- **WorkspaceView**: unchanged workspaceId/path/title/sessionIds/createdAt/updatedAt. Catalog state retains schemaVersion 1, legacyReconciled, workspaces, archived/pinned IDs and ignored paths. Pi wire types reference the neutral DTO.
- **Catalog operations**: create, attachSession, list, removeSession use narrow explicit interfaces; no implementation class type derivation. Catalog events describe workspace/session changes without Pi publisher dependency. Pi adapter restores existing host/* event names once after successful persistence. Listener failures cannot roll back saved state.
- **Surface state**: existing surface map/order/history/active placements/scope and widths; headless runtime is sole owner. React provider acquires the existing installation-scoped resource and returns cleanup. Draft/feedback records remain instance-scoped.
- **File presentation**: existing material manifest/icon mapping with explicit resource base URL; Explorer file-name parts remain workspace-files. Download remains browser-only leaf with lazy document/window access and unchanged object URL/picker cleanup.
- **Client session**: single authority for message/history/composer state, focused history/attachment/interaction owners with narrow callbacks; manager owns directory/connection composition. No duplicate snapshots introduced for decomposition.
- **Server session**: existing registry identity, catalog cache, live sessions, serialization and scratch lifecycle. Components own focused maps/state while receiving explicit operations, never the whole registry state. Pi events and JSONL remain unchanged.

Transitions retained: draft→remote, scratch→promoted/released, queued→running→settled/cancelled, history reload/backfill with generation checks, archived↔visible, provisional→persisted scope, installation active→disposed. Tests cover late results and cleanup without UI rendering.
