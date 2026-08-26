# Workbench Extension Contracts

Use this reference to verify the current first-version public API before implementing an extension.

## Contents

- [Public boundary](#public-boundary)
- [Extension lifecycle](#extension-lifecycle)
- [Toolbox catalog metadata](#toolbox-catalog-metadata)
- [Slot contract](#slot-contract)
- [Panel contract](#panel-contract)
- [Command contract](#command-contract)
- [Composer Command contract](#composer-command-contract)
- [Settings contract](#settings-contract)
- [Main View contract](#main-view-contract)
- [Renderer contract](#renderer-contract)
- [Opener contract](#opener-contract)
- [RightWorkspace boundary](#rightworkspace-boundary)
- [Pi runtime boundary](#pi-runtime-boundary)
- [Services available to components](#services-available-to-components)
- [Uniqueness and ordering](#uniqueness-and-ordering)
- [Error isolation](#error-isolation)

## Public boundary

Import definitions and contribution contracts from the host-free authoring entry. Mounted client
components import runtime hooks separately:

```ts
import {
  defineExtension,
  type CommandDefinition,
  type ComposerSlotContext,
  type PanelComponentProps,
  type MainViewProps,
  type WorkspaceActionsSlotContext,
  type WorkspaceSurfaceDefinition,
} from "@/platform/extensions/authoring";
import {
  useCommandService,
  useMainViewService,
  useNavigationService,
  usePanelService,
  useSettingsRegistry,
} from "@/platform/extensions";
```

Source of truth:

- `platform/extensions/authoring.ts`
- `platform/extensions/index.ts`
- `platform/extensions/api/`
- `platform/extensions/extension-context.ts`

Business extensions must not import concrete registries, stores, or the aggregate Host barrel. The
active Message Renderer and shared extension surfaces may use the explicitly allowlisted
`hosts/renderer-host` and `hosts/extension-error-boundary` leaf entries. Main View and Workspace
Surface registration are part of `ExtensionContext`; RightWorkspace controller hooks and Pi runtime
remain separate public boundaries described below.

## Extension lifecycle

```ts
interface ExtensionContext {
  readonly slots: SlotRegistry;
  readonly panels: PanelRegistry;
  readonly commands: CommandRegistry;
  readonly openers: OpenerRegistry;
  readonly composerCommands: ComposerCommandRegistry;
  readonly renderers: RendererRegistry;
  readonly settings: SettingsRegistry;
  readonly mainViews: MainViewRegistry;
  readonly workspace: WorkspaceSurfaceRegistry;
}

type ExtensionSetupResult = void | Disposable | readonly Disposable[];

interface WorkbenchExtension {
  id: string;
  name: string;
  version: string;
  toolbox?: ExtensionToolboxCapability;
  setup(context: ExtensionContext): ExtensionSetupResult;
}
```

`defineExtension()` preserves literal types; ExtensionManager performs runtime validation and activation. `setup()` is synchronous. Setup failure rolls back registrations. Deactivation disposes resources in reverse order.

These extensions are trusted, in-process, statically bundled contribution containers. They are not
third-party plugins and do not imply an Extension Host, permissions, or a stable external ABI.

Distribution is separate from the contribution lifecycle. Fixed product capabilities live in
`extensions/builtin/` and enter `builtinExtensions`. User-installable component bundles live in
`extensions/installable/`, declare `toolbox.distribution: "installable"`, and enter the static
`installableComponentExtensions` catalog. The application persists whether each catalog entry is
installed and passes only installed entries to `ExtensionProvider`; uninstalling therefore invokes
normal ExtensionManager deactivation and disposes every owned contribution. Catalog code remains
statically bundled for safe reinstallation—there is no filesystem discovery or arbitrary runtime
JavaScript loading.

Define extension objects at module scope. ExtensionProvider compares object identity when synchronizing the static array.

## Toolbox catalog metadata

`WorkbenchExtension.toolbox` is optional discovery metadata for real React component contributions.
It lets the Toolbox list, locate, preview, and—when the static catalog allows it—install a component
extension. It does not register or activate a contribution; `setup()` must still register the same
component against its actual public Registry.

```ts
interface ExtensionToolboxCapability {
  kind: "component-extension";
  distribution: "builtin" | "installable";
  name: LocalizableText;
  description?: LocalizableText;
  entryFile: string;
  contributions: readonly [ComponentExtensionContribution, ...ComponentExtensionContribution[]];
}

type ComponentExtensionContributionKind =
  | "slot"
  | "panel"
  | "message-renderer"
  | "message-part-renderer"
  | "tool-renderer"
  | "data-renderer"
  | "settings-section"
  | "settings-item"
  | "main-view"
  | "workspace-surface";

interface ComponentExtensionContributionBase {
  id: string;
  surface: LocalizableText;
  host?: string;
  description?: LocalizableText;
  preview: ComponentType;
  sourceFiles: readonly [string, ...string[]];
}
```

For `kind: "slot"`, `target` must be a real `WorkbenchSlot`; for `kind: "panel"`, it must be a
`PanelLocation`; other kinds use their actual Registry key or host path. Keep `id`, `target`,
`entryFile`, and `sourceFiles` aligned with the implementation. The preview is a no-props component
that uses the real design system and renders representative states without invoking privileged
runtime behavior. Use typed `defineMessage(...)` descriptors for user-visible metadata.

An uninstallable entry belongs under `extensions/installable/<feature>/`, declares
`distribution: "installable"`, and is listed in `installableComponentExtensions`. Fixed product
features remain under `extensions/builtin/` and enter `builtinExtensions`; adding Toolbox metadata
does not change that ownership boundary.

## Slot contract

Available slots:

```text
header.left
header.center
header.right
shell.background
shell.overlay
sidebar.brand
sidebar.header
sidebar.navigation
sidebar.toolbox
sidebar.workspace.actions
sidebar.top
sidebar.bottom
sidebar.footer
panel.right.add-menu
panel.right.actions
workspace.actions
workspace.empty.actions
thread.left
thread.header
thread.before
thread.after
thread.right
message.before
message.after
message.actions
composer.before
composer.actions.left
composer.actions.right
composer.drawer.left
composer.drawer.right
composer.after
statusbar.left
statusbar.right
```

Context types:

```ts
interface MessageSlotContext {
  messageId: string;
  role: "user" | "assistant" | "system";
  isLast: boolean;
}

interface ComposerSlotContext {
  isRunning: boolean;
  isEmpty: boolean;
}

interface ComposerDrawerSlotContext extends ComposerSlotContext {
  closeDrawer(): void;
}

interface SidebarToolboxSlotContext {
  searchQuery: string;
}

interface RightPanelAddMenuSlotContext {
  activePanelId: string;
  closeMenu(): void;
}

interface RightPanelActionsSlotContext {
  activePanelId: string;
}

interface WorkspaceActionsSlotContext {
  activeSurfaceId?: string;
  isOpen: boolean;
}

interface WorkspaceEmptyActionsSlotContext {
  isOpen: boolean;
}

interface SlotPropsMap {
  "shell.background": Record<never, never>;
  "shell.overlay": Record<never, never>;
  "sidebar.toolbox": SidebarToolboxSlotContext;
  "panel.right.add-menu": RightPanelAddMenuSlotContext;
  "panel.right.actions": RightPanelActionsSlotContext;
  "workspace.actions": WorkspaceActionsSlotContext;
  "workspace.empty.actions": WorkspaceEmptyActionsSlotContext;
  "thread.left": { threadId?: string };
  "thread.header": { threadId?: string };
  "thread.before": { threadId?: string };
  "thread.after": { threadId?: string };
  "thread.right": { threadId?: string };
  "message.before": MessageSlotContext;
  "message.after": MessageSlotContext;
  "message.actions": MessageSlotContext;
  "composer.before": ComposerSlotContext;
  "composer.actions.left": ComposerSlotContext;
  "composer.actions.right": ComposerSlotContext;
  "composer.drawer.left": ComposerDrawerSlotContext;
  "composer.drawer.right": ComposerDrawerSlotContext;
  "composer.after": ComposerSlotContext;
  // Other Header, Sidebar, and Statusbar slots use Record<never, never>.
}
```

`thread.left` and `thread.right` render at full height beside the central Thread column. A
contribution should define its own width; use a Panel instead when the surface needs host-managed
resizing, tabs, or open/close state.

Contribution shape:

```ts
interface SlotContribution<K extends WorkbenchSlot> {
  id: string;
  component: ComponentType<SlotPropsMap[K]>;
  order?: number;
}
```

Slot `order` defaults to `0`, sorts ascending, and preserves registration order for ties. Contribution id is unique within one Slot.

`shell.background` mounts once beneath the Workbench content. Use it for non-interactive theme
backgrounds, textures, and visual effects. Keep contributions pointer-inert and coordinate shared
surface colors through theme variables rather than covering interactive content.

`shell.overlay` mounts once in the Workbench global layer. Use it for controlled dialogs and other
portal-backed floating surfaces that must be reachable from multiple responsive entry points. A
feature owns the surface state and close behavior; the Slot host only provides global placement and
error isolation.

Sidebar positions are semantic:

- `sidebar.brand`: replaceable product identity at the top of the sidebar;
- `sidebar.header`: optional compact controls below the brand;
- `sidebar.navigation`: optional navigation directly after the core section switcher;
- `sidebar.toolbox`: the Toolbox section body, filtered with the host-owned `searchQuery`;
- `sidebar.workspace.actions`: compact controls on the right side of the Workspace heading;
- `sidebar.top`: contextual content above the core thread list;
- `sidebar.bottom`: contextual content below the core thread list;
- `sidebar.footer`: persistent bottom utilities.

`sidebar.toolbox` is the compact root of the Toolbox section and receives `{ searchQuery: string }`.
Keep category pages and long details out of the narrow sidebar: open a Main View to replace the
conversation. Do not route toolbox management pages into RightWorkspace.

The mobile conversation Sheet mounts `sidebar.workspace.actions`, but not `sidebar.brand`,
`sidebar.header`, `sidebar.navigation`, `sidebar.top`, `sidebar.bottom`, or `sidebar.footer`. Add a
suitable mobile `header.*` contribution when a desktop-only Sidebar contribution also needs a touch
entry point.

`panel.right.add-menu` and `panel.right.actions` remain declared for the legacy right PanelDock, but
the current shell does not mount a right Panel host. Do not use them for new entry points. The
current inspector toolbar mounts `workspace.actions`; contributions receive
`{ activeSurfaceId?, isOpen }` and should render one compact, accessible control.
`workspace.empty.actions` receives `{ isOpen }` and contributes a launch action only while the
Inspector has no Surface. Inspector capabilities are registered separately through
`context.workspace.register(...)`.

## Panel contract

```ts
type PanelLocation = "left" | "right" | "bottom";

interface PanelComponentProps {
  panelId: string;
  close(): void;
}

interface PanelTabComponentProps {
  panelId: string;
  isActive: boolean;
}

type PanelTabClassName = string | ((context: PanelTabComponentProps) => string | undefined);

interface PanelTabClassNames {
  root?: PanelTabClassName;
  trigger?: PanelTabClassName;
  closeButton?: PanelTabClassName;
}

interface PanelDefinition {
  id: string;
  title?: LocalizableText;
  icon?: LucideIcon;
  tabComponent?: ComponentType<PanelTabComponentProps>;
  tabClassNames?: PanelTabClassNames;
  component: ComponentType<PanelComponentProps>;
  defaultLocation: PanelLocation;
  defaultSize?: number;
  minSize?: number;
  maxSize?: number;
}
```

Sizes are pixels. Registration only defines a Panel; it does not open it. A Panel must define either `title` or `tabComponent`. `title` accepts plain text or a typed i18n message descriptor created with `defineMessage`; built-in extensions should use a descriptor so the host resolves the current locale at render time. Static `title` and `icon` are the simple/default label. `tabComponent` and `tabClassNames` remain part of the compatibility contract for a tabbed Panel host.

`tabClassNames` merges extension classes after the host defaults through `cn()`/`tailwind-merge`, so an extension can override the tab `root`, selection `trigger`, and `closeButton` without copying host behavior. Each entry may be a string or a pure function of `{ panelId, isActive }`. Class functions run during render and must not call React hooks; use `tabComponent` when render-time hooks are required. The root exposes `data-panel-id` and `data-state="active|inactive"` for variant selectors.

Only one Panel is active per location. Size is stored per location, not per Panel, and is not persisted across reloads in v1. Although `PanelLocation` still includes `"right"`, the current shell mounts Panel hosts only for `"left"` and `"bottom"`; a Panel moved to `"right"` has no visible host. New persistent inspector content belongs in RightWorkspace. A fixed-location Panel should explicitly call `move(panelId, location)` before toggling so stale stored locations cannot hide it.

## Command contract

```ts
interface CommandDefinition {
  id: string;
  title: LocalizableText;
  description?: LocalizableText;
  category?: LocalizableText;
  icon?: LucideIcon;
  shortcut?: readonly string[];
  run(context: CommandExecutionContext): void | Promise<void>;
}

interface CommandExecutionContext {
  panels: {
    open(panelId: string): void;
    close(panelId: string): void;
    toggle(panelId: string): void;
    move(panelId: string, location: PanelLocation): void;
  };
  navigation: {
    newThread(): void;
    openThread(threadId: string): void;
  };
}
```

`LocalizableText` is either literal text or a typed descriptor from `defineMessage(...)`. Built-in extensions should register descriptors, not translated strings, so the command host can update immediately when the locale changes.

Registered commands appear in the `Mod+K` palette. Shortcut tokens support `Mod`/`CmdOrCtrl`, Ctrl, Meta/Cmd, Alt/Option, Shift, and exactly one normal key. Modifier matching inside `CommandService` is exact. Shortcut conflicts resolve to the first registered command, so avoid conflicts explicitly.

Also search standalone global `keydown` listeners outside `CommandService`. For example, the sidebar's `Mod+B` listener accepts `Mod+Shift+B` because it does not reject extra modifiers, so that combination would trigger both features.

## Composer Command contract

`context.composerCommands` registers structured entities compiled at Composer submit time. It is
separate from the global `context.commands` action palette.

```ts
interface ComposerCommandOptions {
  behavior: "modifier" | "context" | "transform" | "immediate";
  effect?: ComposerCommandEffect;
  exclusive?: boolean;
  group?: string;
  scope?: "message" | "segment";
  argsSchema?: Readonly<Record<string, ComposerJsonValue>>;
  argsBinding?: {
    kind: "message-text";
    field: string;
    consumeText: boolean;
  };
  apply(draft: ComposerCommandRequestDraft, context: ComposerCommandApplyContext): void;
}
```

The first argument-binding version accepts only `message-text`. A bound command must declare an
`argsSchema`, be `exclusive: true`, and use message scope. Selection opens a structured parameter
panel above the Composer; the bound field receives a multiline editor and other schema properties
receive matching controls. Closing the panel retains the token, clicking the token reopens it, and
deleting the token clears its values. Parameters compile directly into `command.args`, while all
text typed after the token remains ordinary Agent request text. `consumeText` exists only for legacy
client fallback. Historical canonical `command-argument` nodes remain supported.

## Settings contract

The shared floating settings surface is composed from independently registered sections and feature-owned items:

```ts
interface SettingsSectionDefinition {
  id: string;
  title: LocalizableText;
  description?: LocalizableText;
  icon?: LucideIcon;
  headerAction?: ComponentType<SettingsSectionHeaderActionComponentProps>;
  group?: {
    id: string;
    title: LocalizableText;
  };
  order?: number;
}

interface SettingsSectionHeaderActionComponentProps {
  sectionId: string;
}

interface SettingsItemComponentProps {
  sectionId: string;
  itemId: string;
}

interface SettingsItemDefinition {
  sectionId: string;
  id: string;
  component: ComponentType<SettingsItemComponentProps>;
  order?: number;
}

interface SettingsRegistry {
  registerSection(section: SettingsSectionDefinition): Disposable;
  registerItem(item: SettingsItemDefinition): Disposable;
  getSections(): readonly SettingsSectionDefinition[];
  getItems(): readonly SettingsItemDefinition[];
  subscribe(listener: () => void): () => void;
}
```

Section ids are globally unique. Item ids are unique within one section. Sections that share a
`group.id` render beneath one localizable navigation heading; use the same title descriptor for
every occurrence of that group id. `headerAction` renders a feature-owned control beside the section
content heading and receives the stable section id; the
Settings Host owns its placement and error isolation. Sections and items sort by
ascending `order`, preserving registration order for ties. An item may register before its target
section so static extension activation order does not create a dependency. The settings Host owns
navigation, headings, scrolling, separators, and error isolation; item components own their
preference UI, state, and persistence.

Use `useSettingsRegistry()` only in the shared settings Host or tooling that needs subscribed
snapshots. Business extensions should register contributions synchronously in `setup()`.

## Main View contract

Use a Main View for a full feature page that temporarily replaces the central conversation while
preserving the Workbench shell and sidebar:

```ts
interface MainViewDefinition<P extends Record<string, unknown>> {
  kind: string;
  component: ComponentType<MainViewProps<P>>;
}

interface MainViewProps<P extends Record<string, unknown>> {
  view: { kind: string; title: LocalizableText; params: P; revision: number };
  close(): void;
}

context.mainViews.register({ kind: "example", component: ExampleMainView });
mainViews.open({
  kind: "example",
  title: defineMessage("extensions.toolbox.packages.title"),
  params: { section: "catalog" },
});
```

Call `useMainViewService()` from a mounted extension component. `open()` accepts registered kinds
only and shallow-freezes feature-owned params. Every request increments `revision`, including
requests for the active kind. `close()` restores the conversation; switching the core sidebar to
Workspace, changing the conversation URL, or unregistering the definition also closes the active
Main View.

Every open request also supplies a `LocalizableText` title. The Workbench header resolves it at
render time, so built-in extensions should pass a `defineMessage(...)` descriptor instead of a
translated string. A Main View title replaces the conversation title only while that view is active.

Main Views own their internal navigation, layout, and i18n. They do not provide URL routing,
resource keys, persistent tabs, scopes, or keep-alive behavior. Use a Next.js route for URL identity
and a Workspace Surface for a persistent, resource-scoped right Inspector.

## Renderer contract

```ts
type ToolRendererComponent = ToolCallMessagePartComponent;
type DataRendererComponent = DataMessagePartComponent;

context.renderers.message.register({ id, component: MessageRenderer });
context.renderers.parts.register({ id, canRender, component: MessagePartRenderer });
context.renderers.tools.register(toolName, ToolRenderer);
context.renderers.data.register(dataName, DataRenderer);
context.renderers.toolPresentations.register(toolName, toolPresentation);
context.renderers.dataPresentations.register(dataName, dataPresentation);
```

The Message Renderer is a singleton contribution that owns `MessagePrimitive.Parts` or
`MessagePrimitive.GroupedParts`, including reasoning/tool/data grouping and presentation. Only one
can be active; without one, Workbench renders its minimal fallback. Tool and Data renderers compose
under it through `RendererHost` and retain exact, case-sensitive name matching in separate
uniqueness scopes. Predicate-matched Message Part renderers are tried in registration order; the
first match wins, and the active Message Renderer decides where to mount `MessagePartRendererHost`
with its existing fallback. Renderer APIs have no numeric `order` or `priority` field.

Tool/Data presentation registries add timeline metadata without replacing the corresponding Part
renderer. Tool presentations provide localizable active/completed labels, an icon, an optional pure
stream-safe summary, and an optional disclosure controller. Data presentations can opt a named Data
Part into the timeline and provide pure visibility/activity predicates. Names are exact,
case-sensitive, and independently unique from the Tool/Data renderer registries.

Resolution order:

1. exact-name extension Renderer;
2. Part-provided `toolUI` or `dataRendererUI`;
3. fallback supplied by the active Message Renderer, or the Workbench safety fallback;
4. `RendererHost` children.

A Renderer only displays an existing message Part. It does not define a tool, expose it to a model, execute it, or cause a data Part to be emitted.

Tool args are partial during streaming. Handle `running`, `complete`, `incomplete`, and `requires-action` as applicable. Tool renderer props can expose `addResult()`, `resume()`, and `respondToApproval()`; call them only in the matching Runtime state.

`ToolPresentationDefinition.disclosureController` is an optional component mounted outside the
tool-detail disclosure. It receives the current Part, `running`, `open`, and the host-owned
`onOpenChange`; use it when an extension-owned asynchronous presentation signal—such as a terminal
waiting for input—must reveal a collapsed Tool Renderer. It is presentation-only: do not execute the
tool, duplicate the detail UI, or mutate the Part from this controller.

## Opener contract

Use an Open Handler when one contribution needs to open a resource owned by another contribution.
The caller submits a neutral resource descriptor; the owner translates it into its own Surface:

```ts
interface OpenableResource {
  scheme: string;
  path: string;
  label?: string;
}

interface OpenResourceRequest {
  resource: OpenableResource;
  context: WorkspaceContext;
  scope?: WorkspaceScope;
  policy?: SurfaceOpenPolicy;
}

interface OpenHandlerDefinition {
  id: string;
  canOpen(request: OpenResourceRequest): number;
  open(
    request: OpenResourceRequest,
    context: { surfaces: WorkspaceSurfaceOpenOperations },
  ): string | void | Promise<string | void>;
}
```

Register ownership synchronously with `context.openers.register(handler)`. A `canOpen()` score of
zero means unsupported; the highest positive score wins and registration order breaks ties. Client
components call `useOpenerService().open(request)` from `@/components/right-workspace` and must
handle rejection in event handlers. Setup never calls a React hook because the service injects
`open/reveal` Surface operations only when executing the handler.

Do not deep-import a sibling `extensions/builtin/<feature>`. Promote genuinely shared capability
contracts to `services/` or `runtime/`, and use the Opener only for resource ownership/routing.

## RightWorkspace boundary

RightWorkspace is the generic inspector tab host mounted to the right of the Workbench. Concrete
capabilities are Workspace Surface contributions registered through `ExtensionContext.workspace`.

Source of truth:

- `platform/extensions/api/workspace-surface.ts`: public contribution, instance, scope, and registry contracts;
- `platform/extensions/registries/workspace-surface-registry.ts`: tracked capability registry;
- `components/right-workspace/index.ts`: public controller and state hooks;
- `components/right-workspace/core/surface-types.ts`: core layout state and public type re-exports;
- `components/right-workspace/core/workspace-controller.ts`: `open`, `reveal`, `focus`, `close`,
  update, layout, and restore operations.

Register a definition synchronously in setup:

```ts
const surface = context.workspace.register({
  kind: "example",
  icon: ExampleIcon,
  cachePolicy: "keep-alive",
  persistence: "persistent",
  defaultPlacement: "primary",
  allowDuplicateResources: false,
  getResourceKey: (params, workspaceContext) =>
    `example:${workspaceContext.projectId}:${params.id}`,
  getDefaultScope: (_params, workspaceContext) => ({
    type: "project",
    key: workspaceContext.projectId ?? workspaceContext.applicationId,
  }),
  header: ExampleSurfaceHeader,
  render: ExampleSurface,
  menuItem: ExampleMenuItem,
  runtime: ExampleRuntimeBridge,
});
```

`kind` is globally unique. `menuItem` is rendered in the core add-surface menu and `runtime` is
mounted once inside AssistantRuntimeProvider. Both are optional and owned by the extension.
Registration is tracked and removed on rollback/deactivation.

`cachePolicy` controls whether inactive content stays mounted. `persistence: "session"` excludes an
instance from reload restoration; omission behaves as persistent. `defaultPlacement` defaults to
`"primary"`. Unless `allowDuplicateResources` is true, opening the same `resourceKey` reveals or
moves the existing instance instead of creating another one.

`header` is optional active-primary chrome. The core mounts it once above both the primary and
auxiliary panes, so feature-owned breadcrumbs or resource actions can span the complete inspector
without the core knowing the feature kind. It is never persisted and is not rendered for an
auxiliary-only Surface.

`render` accepts a component. Use `createLazyWorkspaceSurface()` around a dynamic import for code
splitting; `SurfaceHost` supplies the shared Suspense fallback, mounts the implementation on first
activation, and recreates a rejected lazy loader when the user retries. Lightweight definitions are
still registered synchronously at startup.

RightWorkspace core treats `kind` as an opaque stable id. It does not contain capability maps,
feature icons, domain services, or Agent tool mappings. Persisted instances survive while a
definition is unavailable and render again if the extension returns. Use `useRightWorkspace()` and
`useWorkspaceContext()` inside client contributions to open a registered kind; do not call hooks
from setup.

`RightWorkspaceController.setAuxiliaryOpen(boolean)` controls only the generic auxiliary-pane
visibility. Hiding it preserves the active auxiliary Surface instance and its mounted state;
explicitly focusing/opening an auxiliary Surface reveals it again, while a background reveal does
not override the user's hidden choice. Extensions may use this generic layout action without
importing or naming the contribution currently rendered in that pane.

## Pi runtime boundary

Read `runtime/pi/README.md` completely before adding Pi-backed UI. It is the maintained architecture
and capability reference. Verify exact shapes against:

- `runtime/pi/rpc-contracts.ts` for unary RPC envelopes and payload/value types;
- `runtime/pi/stream-contracts.ts` for mux/host WebSocket frames;
- `runtime/pi/client/transport/api.ts` for existing browser-side RPC helpers;
- `runtime/pi/client/runtime/context.tsx` and `manager.ts` for session-manager state and actions.

New UI reads authoritative snapshots through the manager or typed unary helpers and receives deltas
through the shared paired mux/host WebSocket connection. Do not issue raw `fetch()` calls, create a
second WebSocket/SSE connection, duplicate payload interfaces, or treat HTTP `200` as business
success without checking the RPC result envelope.

`/api/pi/**`, legacy contracts, and `legacy-sse.ts` are compatibility paths, not the default for new
features. Use one only when `runtime/pi/README.md` explicitly identifies a remaining exception (for
example the current queue-pause compatibility command). If a required method is missing, extend the
wire contracts, validation/router, domain service, client helper, and tests before wiring the UI.
Do not infer unimplemented Harness APIs or bypass the trust boundary from a component.

When the change reaches server-side SDK code, switch references instead of treating the browser
runtime as the package API: use `$pi-coding-agent-sdk` for AgentSession, coding-agent extensions,
resource loading, and `@earendil-works/pi-coding-agent`; use `$pi-ai-sdk` for model/provider/auth,
message/tool schemas, image requests, streaming events, and direct `@earendil-works/pi-ai` work.
Browser extensions should consume those capabilities through the maintained Workbench Pi contracts
and shared connection.

## Services available to components

Use hooks inside client components:

```ts
const panels = usePanelService();
const commands = useCommandService();
const navigation = useNavigationService();
const settings = useSettingsRegistry();
```

PanelService provides:

```text
open, close, toggle, activate, move, collapse, expand, setSize
isOpen, isCollapsed, getActivePanelId, getSize, getLocation
```

CommandService `execute(id)` returns a Promise. Catch rejection when invoking it from an event handler.

`useSettingsRegistry()` is intended for the shared Settings host or subscribed tooling. Business
extensions normally register sections/items synchronously through `context.settings`.

RightWorkspace and `useOpenerService()` hooks come from `@/components/right-workspace`, Workspace
Surface/Open Handler registration comes from `context.workspace`/`context.openers`, and Pi manager
hooks come from `@/runtime/pi/client/runtime/context`.

Use `useAui()` and `useAuiState()` for assistant-ui Runtime state. Do not mirror chat state in a separate extension store.

## Uniqueness and ordering

```text
Extension id          global within ExtensionManager
Slot contribution id unique within one Slot
Panel id              global within PanelRegistry
Command id            global within CommandRegistry
Composer command id   global within ComposerCommandRegistry
Open handler id       global within OpenerRegistry
Settings section id   global within SettingsRegistry
Main view kind         global within MainViewRegistry
Settings item id      unique within one settings section
Message renderer      one active within Message RendererRegistry
Message part renderer id global within MessagePartRendererRegistry
Tool renderer name    unique within Tool RendererRegistry
Data renderer name    unique within Data RendererRegistry
Tool presentation name unique within ToolPresentationRegistry
Data presentation name unique within DataPresentationRegistry
Workspace surface kind global within WorkspaceSurfaceRegistry
```

Slots and Settings sections/items have numeric ordering. The combined active extension order
(`builtinExtensions`, then installed entries from `installableComponentExtensions`) determines
activation order, same-order ties across extension registrations, conflicting shortcut selection,
and command display order within a category.

Slot, Panel, Command, Composer Command, Open Handler, Renderer/presentation, Settings, Main View, and
Workspace Surface definitions are copied and shallow-frozen at registration. Dispose and register a
replacement instead of mutating registered data.

## Error isolation

Slot, Panel, Settings item, Main View, Renderer, and Workspace Surface contributions receive separate
React Error Boundaries. Setup failures are reported and rolled back. Palette/keyboard Command
execution reports rejected Promises.

React Error Boundaries do not catch event-handler errors or arbitrary asynchronous failures. Handle those locally or route them through the extension environment.
