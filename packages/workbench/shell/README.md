# @workbench/shell

This package owns the platform-independent Workbench shell and UI closure that can be installed by
web, desktop, and future hosts. Its finite public entries are grouped by responsibility:

- `./workbench`, `./layout`, `./chat`, `./elements`, `./ui`, `./hooks`, and
  `./workspace-file-tree` provide the generic shell frame and presentation components.
- `./navigation` and `./runtime-connection` are explicit application ports. Shell asks for semantic
  home/conversation navigation and an installed runtime connection; it does not know routes,
  origins, or platform transports.
- `./i18n` owns the base Shell catalog/runtime and immutable, provider-local translation bundles;
  `./i18n/runtime` is the server-safe finite entry with no React Provider/client module. Product and
  runtime packages retain their own bilingual catalogs and inject them at composition.
- `./settings`, `./appearance`, and `./extensions` own generic preferences and semantic extension
  groups (`core`, `settings`, `workspace`, `files`, `interactions`, `attachments`, `automations`,
  `models`, and `context`). Product-specific Settings actions are registered by
  their owning extensions, while the Shell Settings extension remains static.
- `./panels` exposes `createPanelStore`; application composition creates one store per Workbench
  installation instead of sharing process-global panel state.
- `./workspace-files` owns installation-local file buffers, diffs, and the capability-backed file
  runtime. Directory/trust selection, local-app actions, Workspace File, and Git Branch consume only
  Workbench host/workspace capabilities; unsupported capabilities hide their entry points or show
  an explicit unavailable state. Runtime-specific resource readers can supply the existing file
  session contract without exposing their RPC types to Shell.
- Interactive Requests, Side Chat, Automation, Model Selector, Image Understanding, and Token
  Usage/Context Policy also live in Shell. They consume Workbench capabilities and stable errors;
  provider authentication/configuration and implementation-specific diagnostics stay with the Runtime.
- `./presentation` and `./running-indicator` accept explicit branding, asset roots, and an immutable
  indicator catalog. The package contains no product logo or product-specific indicator.
- `./right-workspace`, `./right-workspace/react`, `./right-workspace/presentation`, and
  `./right-workspace/persistence` own the controller lifecycle, injected registry/opener ports,
  settings persistence, runtime-neutral feedback claim/CAS store, state, selectors, layout,
  accessibility, and presentation.
- `./styles.css` is the public stylesheet entry for Web and Desktop. It owns global theme/control
  defaults and scrollbars, and imports colocated Shell, sidebar, conversation, and renderer styles.
  Applications declare their package-source Tailwind scan roots and host fonts only.

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
Electron, root aliases, raw WebSockets, or product endpoints. The sole SDK-internal import is
the catalog runtime's branded descriptor constructor; the transport boundary guard enforces that
exact file and named export. Read-only compatibility with legacy product directives/storage is
centralized in one private helper and never used for new writes. `get-east-asian-width` is owned by
this package because the conversation-title helper is its only production consumer.

## Sidebar presentation and interaction

Projects and Pinned use a dedicated section heading; workspace folders, conversations, and drafts
use item rows. These primitives live in `src/ui/sidebar-items.tsx`, exported through
`@workbench/shell/ui`:

| Component               | Contract                                                                                                                                                                                                                                                    |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SidebarGroup`          | Controlled `open` / `onOpenChange`, `header`, and `children`; reuses `Collapsible` for expansion and animation. `indent` adds child indentation; `dropPosition` draws group-level insertion feedback.                                                       |
| `SidebarSectionHeading` | Dedicated Projects / Pinned heading with `label`, `expanded`, `description`, `actions`, and an optional receiving `drag` binding. Uses `CollapsibleTrigger`, a chevron after the label, and no selectable or hover background.                              |
| `SidebarRow`            | `folder` or `item` variant with `icon`, `hoverIcon`, `label`, `description`, `status`, `actions`, `active`, `menuOpen`, and an optional `drag` binding. `trigger` defaults to `Button`; use `CollapsibleTrigger` for expandable folder rows.                |
| `SidebarStatus`         | Trailing content with shared alignment and truncation. Set `secondary` for timestamps hidden on touch or narrow layouts; waiting and unread-completion indicators remain primary.                                                                           |
| `SidebarActions`        | Put controls shared by all devices in `children`; `desktop` and `mobile` contain additional quick actions. Owns visibility, spacing, touch targets, and the `data-sidebar-actions` marker that prevents drag initiation. Folder menus reuse `DropdownMenu`. |

The primary trigger and actions are sibling DOM elements. Supply navigation through `onActivate`,
keep action buttons in `SidebarActions`, and pass controlled menu state to `menuOpen`. Row labels,
descriptions, and status are associated with the trigger for accessibility. The row owns its
selection background, keeping the trigger transparent so it cannot cover icons or status.
Section headings remain plain labels when expanded, hovered, or focused; keyboard focus outlines
and valid drop outlines provide their interaction feedback. They do not use `SidebarRow` or its
selection state. Both heading and row actions use `SidebarActions` as siblings of the trigger.
Workspace conversation and draft lists leave `SidebarGroup.indent` disabled. Their rows, including
selection and hover backgrounds, span the same width as the folder header. Icon space belongs
inside the row and does not inset its background.

Each workspace folder, including pinned folders, initially shows five conversation rows (counting
the draft when present). A trailing Show more button reveals five more at a time and disappears
once all matches are visible. Closing keeps the current rows for the collapse animation; reopening
resets the visible count to five before the panel measures its height.
Workspace folders enable `SidebarGroup.animateContent`: the existing collapsible height transition
also follows changes in the measured content height, and newly mounted rows fade in. Both effects
respect reduced-motion preferences; measuring content avoids fixed heights across control densities.
Pagination only limits rendering after search filtering; ordering and drag operations retain the
complete conversation list.

These primitives accept React content and callbacks. Runtime subscriptions, workspace operations,
navigation, persistence, and localized copy belong to `src/sidebar/`; the shared UI does not import
Runtime or `elements`. Layout and interaction styles live in `src/ui/sidebar-items.css`, scoped to the actual
`[data-workbench-surface="sidebar"]` DOM (including the mobile Sheet), using
`--sidebar-row-*`, `--sidebar-action-*`, `--sidebar-drop-line-size`, and existing control, icon,
selection, and theme tokens. Extend these shared rules instead of duplicating row styles in a
consumer.

### Style ownership

Global theme, shared control defaults, and scrollbar tokens remain in `src/styles.css`.
`src/shell/shell-layout.css` owns Shell header/statusbar heights and layout motion. The sidebar and
index use `--layout-state-motion-duration`, which remains independent of the continuous width
motion disabled during native window resizing. Titlebar `env()` values stay on their actual users.

`src/ui/sidebar-items.css` owns sidebar row and action tokens. Their defaults are 31.5 CSS px per
row and 2 CSS px between list items. `.sidebar-menu` opts detached menu popups into sidebar menu
presentation; Portal placement remains inside the installation's existing container.

`src/chat/conversation.css` scopes conversation defaults to `[data-slot="workbench-conversation"]`
for both central and side-chat views. Composer controls use `[data-slot="workbench-composer-shell"]`
and `[data-slot="workbench-composer-actions"]`; detached Composer menus opt in with
`data-workbench-composer-popup`. Corner-radius preferences are selected locally through the Shell's
`data-workbench-corner-radius` state, without exposing Composer geometry at the document root.
Markdown/Streamdown styles live with the renderer and work outside the conversation as well.

Lucide's existing Provider supplies the Shell's default stroke; explicit icon choices remain valid.
Shared button primitives own their default glyph size. Override `--button-icon-size` and
`--button-icon-frame-size` on the control to adapt it, or the area's `--sidebar-icon-size`,
`--thread-icon-size`, and `--message-action-icon-size` for an area-wide choice. Do not restore
body-level SVG overrides. Regional rules stay in the existing Tailwind cascade layers; avoid
copying shared interaction styles into features.

After changing cascade/scope behavior, run `node scripts/check-workbench-style-scope.mjs
<renderer-websocket-url>` against a running Workbench page. It checks isolation using temporary,
non-interactive DOM fixtures with the page's real CSS and always removes them afterwards.

### Icons, status, and actions

- `icon` and `hoverIcon` share one fixed slot. CSS shows `hoverIcon` on row hover, keyboard focus,
  or an open menu; without a replacement, `icon` stays visible. Coarse-pointer/no-hover devices
  show the supplied hover icon directly. Icon switching does not move the label.
- Business rows supply `RunningThreadIndicator` as `icon` while running. The existing global
  indicator selection and reduced-motion preference apply; `none` falls back to the ordinary
  icon. Conversations and drafts normally leave this slot empty; automation conversations retain
  their type icon. Folders use a folder icon with a left hover chevron. Section headings have a
  separate chevron after the label, revealed with their actions on hover/focus or on touch layouts.
- A collapsed folder aggregates running state from its non-pinned conversations. Expanded folders
  let individual conversations display their own indicators. Derive this state with the existing
  Runtime projection and `groupSidebarThreads`, without duplicating it in a presentation store.
- Trailing status is independent of the left running indicator. Its priority is waiting for input
  on a non-current conversation, then unread completion on a non-running conversation, then the
  update time on a non-running conversation. Running and waiting can appear together.
- Desktop hover, keyboard focus, or an open folder menu reveals actions and hides trailing status.
  Touch and narrow layouts keep actions visible, reserve separate space for primary status, and
  hide secondary timestamps. Conversation rows expose pin/unpin and archive buttons directly,
  without an overflow menu. Folder menus include Move up / Move down; conversation ordering uses
  pointer dragging.

### Drag coordination and drop rules

`@workbench/shell/hooks` exports `SidebarDragSessionProvider`, `useSidebarPointerReorder`,
`useSidebarDragState`, and `useSidebarDragSession`. `WorkbenchShell` installs one provider around
its sidebar; a standalone sidebar installs its own. Registration, drag state, pending saves,
overlays, and click suppression are local to that provider.

Register each row or receiving heading with `useSidebarPointerReorder({ id, enabled, resolveDrop,
onDrop })` and pass its returned binding to `SidebarRow` or `SidebarSectionHeading`. `enabled`
controls whether a row can start a drag; register section headings with `enabled: false` so they
only receive drops through `resolveDrop`. Return `before`,
`after`, or `inside` for a permitted drop, and `undefined` otherwise. `onDrop` returns a Promise.
Use typed keys such as `workspace:<id>` and `thread:<id>` to avoid identity collisions. For folder
groups, render `before` / `after` feedback on `SidebarGroup` and `inside` feedback on its header row;
guard controlled expansion with `drag.shouldSuppressClick()`.

The coordinator handles mouse dragging with the existing 5 px activation threshold, installation
portal overlay, horizontal and vertical hit testing within the scroll viewport, edge scrolling,
and a 350 ms post-drag click suppression window. Escape, window blur, pointer cancellation, source
removal, and search activation cancel the drag. Actions never initiate dragging. Touch and keyboard
users can pin/unpin and archive conversations with the shared action buttons, and reorder folders
through their menus.

`src/sidebar/sidebar-move.ts` owns the pure drop policy; `workspace-sidebar-context.tsx` supplies the
current model and commits operations. Pinned conversations precede pinned folders, and each type
has its own order. A conversation's own pin state is independent of its folder's pin state.

| Source and target                                                                  | Result                                                                                                                    |
| ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Same list and type                                                                 | Insert before or after the target.                                                                                        |
| Folder to the other group or one of its folders                                    | Change pin membership and append at the heading or insert beside the folder; preserve the moved folder's expansion state. |
| Conversation to Pinned or a pinned conversation                                    | Pin and append at the heading or insert beside the conversation; preserve workspace ownership.                            |
| Pinned conversation to Projects heading                                            | Unpin and restore the original workspace order, or return to the ungrouped list.                                          |
| Pinned conversation to its own folder or an unpinned conversation in that folder   | Unpin; append when targeting the folder, or insert at the conversation's position. Collapsed folders accept this drop.    |
| Conversation to another workspace, or folders and conversations mixed in one order | Reject the drop.                                                                                                          |

An empty Pinned receiving heading appears during dragging, including when the source is a single
item. A non-empty search disables dragging and menu sorting while leaving pin toggles available.
After a committed move, expand the destination group; restoring a conversation also expands its
own folder, wherever that folder is located. Keep the current conversation selection unchanged.

### Persistence and failure handling

Revalidate the source and target against the latest model before submitting. Drag, button, and menu
moves share the session's pending gate: one move runs at a time, controls are disabled while saving, and
additional `session.run` calls during that interval are ignored rather than queued.

Save pin membership before destination order. A pin failure stops the operation; an order failure
after a successful pin keeps the new membership and reports the ordering failure. The sidebar owns
the `role="alert"` message and its `en-US` / `zh-CN` translations.

Workspace ordering uses the existing workspace capability. Conversation ordering inside a workspace
uses `threadActions.moveWithinWorkspace` when available. Pinned, ungrouped, and fallback workspace
orders use the installation-local `thread-order-store.ts` and the existing
`sidebarThreadOrderByScope` settings field (`pinned`, `ungrouped`, or `workspace:<id>`).
`setManualOrder` returns an awaitable Promise, serializes writes, and merges only the affected scope
into persisted preferences. Failed writes restore that scope's confirmed order only if no newer
local revision has superseded the write. This flow requires no new backend protocol or migration.

Focused regression coverage lives in `sidebar-move.test.ts`, `sidebar-drag-session.test.ts`,
`thread-order-store.test.ts`, and `ui/sidebar-items.test.tsx`, alongside the existing grouping and
sorting tests. When changing behavior, run the affected Node tests through
`scripts/register-typescript-test-loader.mjs`; use Shell/Web type checks for API changes. Browser
verification should resolve rendering or interaction uncertainties such as icon layering, menu
visibility, touch status spacing, cross-group scrolling, cancellation, and appearance settings.
