# @workbench/shell

This package owns the platform-independent Workbench shell and UI closure that can be installed by
web, desktop, and future hosts. Its finite public entries are grouped by responsibility:

- `./workbench`, `./layout`, `./chat`, `./assistant-ui`, `./elements`, `./ui`, `./hooks`, and
  `./workspace-file-tree` provide the generic shell frame and presentation components.
- `./navigation` and `./runtime-connection` are explicit application ports. Shell asks for semantic
  home/conversation navigation and an installed runtime connection; it does not know routes,
  origins, or platform transports.
- `./i18n` owns the base Shell catalog/runtime and immutable, provider-local translation bundles;
  `./i18n/runtime` is the server-safe finite entry with no React Provider/client module. Product and
  runtime packages retain their own bilingual catalogs and inject them at composition.
- `./settings`, `./appearance`, and `./extensions` own generic preferences and semantic extension
  groups (`core`, `settings`, and `workspace`). `createSettingsExtension` accepts the optional
  product-specific Settings header action. Component-extension enablement is deliberately one
  persisted realm-wide preference shared by every Shell installation, not per-installation UI
  state.
- `./panels` exposes `createPanelStore`; application composition creates one store per Workbench
  installation instead of sharing process-global panel state.
- `./presentation` and `./running-indicator` accept explicit branding, asset roots, and an immutable
  indicator catalog. The package contains no product logo or product-specific indicator.
- `./right-workspace`, `./right-workspace/react`, `./right-workspace/presentation`, and
  `./right-workspace/persistence` own the controller lifecycle, injected registry/opener ports,
  settings persistence, runtime-neutral feedback claim/CAS store, state, selectors, layout,
  accessibility, and presentation.
- `./styles.css` explicitly owns the generic semantic theme, control, code, and streamdown styles;
  each consuming application imports it and declares its package-source Tailwind scan roots.

The app-owned main-view host deliberately stays outside this package because it binds product
routing. `WorkbenchShell` receives that component together with branding, assets, and a running
indicator catalog. Application composition also installs the navigation adapter, runtime
connection, settings service, extension registries, and package translation bundles.
Each `WorkbenchShell` owns an isolated thread-scroll cache. Persistence is memory-only by default;
an application that wants restoration across remounts supplies one immutable
`ThreadScrollPersistencePort` whose opaque value and storage namespace remain app-owned. Shell does
not read `sessionStorage` or assume that thread ids are unique across Workbench installations.
Each installation also owns a portal container inside its `[data-workbench-shell]` root. Shell
dialogs, sheets, menus, popovers, tooltips, preview cards, and drag overlays target that container,
so floating UI inherits the installation's theme and keyboard ownership instead of escaping to a
realm-global `document.body`. Standalone primitives outside `WorkbenchShell` keep the underlying
library's ordinary body fallback.

The SDK remains the source of truth for Workspace Surface definitions, instances, scopes, registry,
and authoring constants. `./right-workspace` exports only Shell-owned controller/state contracts and
generic layout helpers; root hosts import SDK authoring contracts directly. The controller receives
catalog validation and an opaque-string persistence port, so the reusable controller does not know
product message keys or application ids. The persistence adapter owns the generic settings field
and read-only cleanup of pre-package browser storage.
Workspace UI drafts use the installation-local `useWorkspaceDraftStore`. They remain memory-only
unless the application supplies an immutable, namespaced `RightWorkspaceDraftPersistencePort`;
Shell never selects `sessionStorage`, a realm-global key, or a product migration policy.
Draft thread identity is promoted through the controller's atomic `promoteThreadScope` operation:
the destination thread id is derived from the supplied context, contribution-owned resource keys
are recomputed before one state commit, and non-duplicate collisions retain the live draft instance.
An unavailable contribution still moves scope but keeps its opaque resource key without guessing.

Every `RightWorkspaceProvider` input other than `children` is captured once for one immutable
installation. Change React `key` to replace an owner; same-key prop changes are ignored and reported
as a developer invariant. Strict Effects reuse the committed installation, while true unmount and
key replacement dispose its controller, feedback/draft stores, and workspace service resources. The
exposed state store is read-only;
the Provider's internal context holds only a read-only state-store view, while the public React
entry exposes state only through selector hooks and does not export the raw environment/store.
Stale controller or feedback mutators fail with stable disposed errors.
`createOpener` is a pure construction callback: React development Strict Mode may probe a render
initializer more than once, so it must not subscribe or allocate externally owned resources. Only
the committed installation receives lifecycle guarantees.
Terminal `commit`/`release` operations for an already-issued feedback claim are the deliberate
exception: after disposal they are idempotent no-ops so an in-flight Runtime send can settle without
depending on React cleanup order.

The runtime host identities each mounted bridge by the registry's frozen definition object, not only
by `kind`. Disposing and re-registering the same kind therefore remounts even the same component
function and resets an earlier contribution error boundary without a process-global registry.

This package may consume only the generic Agent Runtime client/contracts and finite public
Extension Host/SDK capabilities needed by reusable UI. It must not import Agent Runtime
implementations, Pi packages or semantics, Next.js, Node production APIs, native packages,
Electron, Tauri, root aliases, raw WebSockets, or product endpoints. The sole SDK-internal import is
the catalog runtime's branded descriptor constructor; the transport boundary guard enforces that
exact file and named export. Read-only compatibility with legacy product directives/storage is
centralized in one private helper and never used for new writes. `get-east-asian-width` is owned by
this package because the conversation-title helper is its only production consumer.
