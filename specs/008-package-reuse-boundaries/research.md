# Research: package reuse boundaries

Date: 2026-09-13. Baseline f95cc7379a42e30e9a1b03aa149e45d1f4c0af2b. The user authorized implementation after the original documentation phase. Existing skill edits remain outside this work.

## Decisions

- **Contracts**: BrowserHost moves to browser-contracts/host. WorkspaceFileReader uses existing request/snapshot DTOs in agent-runtime-contracts/runtime-capabilities. Workspace catalog types and create/attach/list/remove operation ports belong to agent-runtime-contracts/workspace-catalog. Implementations satisfy these contracts; ports no longer derive from concrete browser/file/catalog classes. Rejected copying full service shapes into ports.
- **Catalog owner**: Move the actual WorkspaceStore from pi-resources-server into workspace-server/catalog; neutral catalog state/projections remain there. Reuse server-core file locks and settings documents. Pi resource protocol and server composition adapt neutral events back to unchanged host events. Rejected a new catalog-server/contracts package pair: existing owners already cover this domain and have appropriate dependencies.
- **File presentation**: New client/ui-file-presentation has icons and download subentries, explicit resource configuration, and actual shared material-icon helpers. Existing workspace-files retains tree, runtime-dependent operations and application adapters. Rejected a generic utilities package and requiring Shell context from the new core.
- **Workspace UI**: New client/ui-workspace owns React providers/hooks, surface rendering, DOM resize and CSS. workspace-runtime retains controller/store/pure selectors/draft and feedback state. Rejected moving the entire implementation and leaving a forwarding-only runtime.
- **Pi sessions**: Decompose within pi-client and pi-session-server. Narrow callbacks replace the full manager dependency; extracted modules own coherent state and cleanup. Reuse pi-conversation and pi-transport-client. No new generic session framework, duplicated registry, connection or mutable state.
- **Validation**: Only exact non-UI test files plus type/AST/structure/dependency checks and builds. UI, DOM, Hook-rendering and Browser/Electron smoke execution are excluded. Existing UI tests may move with their owner but are not added or run.
- **SDK**: Installed pi-coding-agent 0.85.1 root declarations expose existing ToolDefinition and session APIs; retain root imports and version. Do not touch SDK sources or deep-import implementation.

## Research ownership

Root inspected W1/W4 interfaces, current consumers, persistence, notification order and Pi adapter. Luna researches W2 source/resources and consumer mapping; Sol researches W3 public/core closure; Sol researches W5/W6 session state and validation. Detailed final migration choices are recorded in ownership-map.md and contracts/public-boundaries.md before each dependent migration.

No external technology selection or unresolved product questions are needed. Current installed source is authoritative. Large browser/model/UI decomposition and tool-output budget fixes remain out of scope as specified.
