# Frozen public boundaries

## W1 and W4

- browser-contracts/host exports BrowserHost(command, optional resolveProjectId); pi-browser imports it rather than owning it. Existing root BrowserHost re-export is removed after consumers move.
- agent-runtime-contracts/runtime-capabilities exports WorkspaceFileReader using existing WorkbenchWorkspaceFileRequest/WorkbenchWorkspaceFileSnapshot, with optional AbortSignal. No concrete server dependency.
- agent-runtime-contracts/workspace-catalog owns WorkspaceView, WorkspaceSessionSnapshot, catalog request/results/events and narrow operation ports. WorkspaceSessionRemovalPort, WorkspaceSessionAttachmentPort, WorkspaceCreationPort, WorkspaceCatalogListPort express independent operations. Existing Pi DTO names refer to the same neutral shapes; wire names and fields are unchanged.
- workspace-server/catalog owns WorkspaceStore, errors and options. onEvent receives neutral workspace/session event names after subscribers; Pi adapter projects them to original host/* payloads. No Pi imports in core. Store dispose detaches notifications; registry replacement disposes the prior notifier. Existing mutation locks, serialization, persistence/legacy reconciliation and subscriber error isolation remain intact.
- Pi server resource-composition/workspace-store remains real event adaptation, not a forwarding shell. It supplies the original stream publisher lazily and preserves caller override behavior. Pi resource workspace protocol retains lazy resolver, session reconciliation, validation and context invalidation.

## W2

- ui-file-presentation/icons owns FileTypeIcon, FolderTypeIcon, materialFileIconIds/materialFolderIconIds/materialIconAssetUrl/MaterialIconIds and FilePresentationProvider with explicit materialIconThemeBaseUrl. Reject missing/empty configuration consistently with existing asset provider. No Shell imports.
- ui-file-presentation/download exports unchanged downloadBlob and saveFileAs. Runtime closure has no React or workspace dependencies. Save picker precedes async read, cancellation propagates, writable failure aborts, Blob URL revokes as before.
- Material helper resides in lib; Explorer-specific file-name-parts remains workspace-files. No old icon/download reexports after consumer migration. Application asset sync and URLs remain original owner; ui-layout supplies the provider once.

## W3

- workspace-runtime retains root state/controller/selectors/feedback plus persistence/directory-store. Directory-store is a headless client selection projection, not server catalog. Type-only agent-client/SDK imports do not violate runtime isolation.
- ui-workspace owns '.', react, presentation, i18n, styles.css plus React/DOM/layout/mount helpers formerly in workspace-runtime. No compatibility forwarders.
- Headless installation owns one controller/store/draft/feedback; React adapter retains Strict Effects scheduling and installation input immutability. Arbitrary presentation resources may stay UI-owned. Preserve original activate/deactivate persistence behavior, disposed-state errors, feedback claim and stale hydration rules.

## W5 and W6

- PiClientSessionDependencies is package-internal and exposes only transport options, connection operations, ensureRemote/model pending operations, feedback claim/commit/release, title/fork and running metadata operations. Manager binds closures. No manager instance/type enters session or focused state modules.
- Client history, attachment, catalog and interaction/run responsibilities own their relevant state once; existing projection/queue and connection owners remain.
- Server registry global/HMR state is composed of focused live, persisted catalog, scratch and fork serialization state owners; preserve singleton identity and generation rules. HostedPiSession remains sole SDK session, event sequence and mutation owner. Focused readers/coordinators receive explicit capabilities, never full RegistryState. Public registry methods and shutdown behavior unchanged.

## Validation and compatibility

Trace runtime and type-only edges separately. Add negative architecture checks for old entrypoints and forbidden closures. API method IDs, extension objects/order, i18n bundle IDs, persistence keys, stream fields and asset addresses do not change. All non-UI behavior is validated with exact test files; UI test movement/import changes are static only.

Runtime closure verification found the SDK root also re-exports createLazyWorkspaceSurface (React). W3 therefore uses the existing SDK api/workspace-surface.ts through the new explicit `extension-sdk/workspace-surfaces` public entry for value constants; root imports for metadata remain type-only. No SDK contract or install behavior changes.

Final server implementation places HostedPiSession in hosted-pi-session.ts, with shared original history/message/metadata rules in session-projections.ts and internal declarations in session-types.ts. Its finite ports provide publisher, changed notification, pending-interaction read/clear, model revision, composer resolution, history reads and optional file reader resolution. Optional missing-file behavior and lazy provider lookup are unchanged. No registry/state object is accepted. Client catalog retains original unconditional changed/removed/order Host notifications; pin/archive notifications retain their prior changed checks. Workspace equality keeps its existing field comparison, and order projection remains linear.
