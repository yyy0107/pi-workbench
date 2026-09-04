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
} from "@workbench/extension-sdk";
import {
  useCommandService,
  useMainViewService,
  useNavigationService,
  usePanelService,
  useSettingsRegistry,
} from "@workbench/extension-host";
```

Source of truth:

- `packages/extension-platform/sdk/src/authoring.ts`
- `packages/extension-platform/sdk/src/index.ts`
- `packages/extension-platform/sdk/src/api/`
- `packages/extension-platform/host/src/index.ts`
- `packages/extension-platform/host/src/extension-context.ts`

Business extensions import authoring definitions and contribution types from the SDK. Mounted
components may import the explicit runtime hooks and Host-owned error types from the Host root, but
must not import its internal composition entry, concrete registries, or services. The active Message
Renderer and shared extension surfaces may use the explicitly allowlisted
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

Distribution is separate from the contribution lifecycle. Fixed product capabilities live in the
owning package's `src/extensions/builtin/` and enter its semantic extension groups. User-installable
component bundles currently live in `packages/workbench/shell/src/extensions/installable/`, declare
`toolbox.distribution: "installable"`, and enter the static
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
  | "message-block-renderer"
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

An uninstallable entry belongs under
`packages/workbench/shell/src/extensions/installable/<feature>/`, declares
`distribution: "installable"`, and is listed in `installableComponentExtensions`. Fixed product
features remain under their owner package's `src/extensions/builtin/` and enter that package's
semantic extension groups; adding Toolbox metadata does not change that ownership boundary.

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
thread.menu
thread.before
thread.after
thread.right
message.before
message.after
message.actions
composer.before
composer.header.left
composer.header.right
composer.actions.left
composer.actions.right
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

interface ThreadMenuSlotContext {
  threadId: string;
  closeMenu(): void;
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
  "thread.menu": ThreadMenuSlotContext;
  "thread.before": { threadId?: string };
  "thread.after": { threadId?: string };
  "thread.right": { threadId?: string };
  "message.before": MessageSlotContext;
  "message.after": MessageSlotContext;
  "message.actions": MessageSlotContext;
  "composer.before": ComposerSlotContext;
  "composer.header.left": ComposerSlotContext;
  "composer.header.right": ComposerSlotContext;
  "composer.actions.left": ComposerSlotContext;
  "composer.actions.right": ComposerSlotContext;
  "composer.after": ComposerSlotContext;
  // Other Header, Sidebar, and Statusbar slots use Record<never, never>.
}
```

`thread.left` and `thread.right` render at full height beside the central Thread column. A
contribution should define its own width; use a Panel instead when the surface needs host-managed
resizing, tabs, or open/close state.

`thread.menu` renders inside the current conversation's header overflow menu. Contributions receive
the durable thread id and must call `closeMenu()` after starting or completing their action. Render
menu-item semantics and include any separator owned by the contribution so an empty Slot leaves no
orphaned chrome.

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
  title: LocalizableText;
  description?: LocalizableText;
  keywords?: readonly LocalizableText[];
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
section so static extension activation order does not create a dependency. Item `title`, optional
`description`, and optional `keywords` are resolved in the current locale and indexed by the shared
settings search. A matching keyword is rendered as the precise result label; selecting a result
opens its section and focuses the registered item. The settings Host owns
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
  view: {
    kind: string;
    title: LocalizableText;
    breadcrumbs?: readonly [
      { label: LocalizableText; params?: P; closeView?: true },
      ...{ label: LocalizableText; params?: P; closeView?: true }[],
    ];
    params: P;
    revision: number;
  };
  close(): void;
}

context.mainViews.register({ kind: "example", component: ExampleMainView });
mainViews.open({
  kind: "example",
  title: defineMessage("extensions.toolbox.packages.title"),
  breadcrumbs: [
    {
      label: defineMessage("extensions.toolbox.title"),
      params: { section: "catalog" },
    },
    { label: defineMessage("extensions.toolbox.packages.title") },
  ],
  params: { section: "catalog" },
});
```

Call `useMainViewService()` from a mounted extension component. `open()` accepts registered kinds
only and shallow-freezes feature-owned params. Every request increments `revision`, including
requests for the active kind. `close()` restores the conversation; switching the core sidebar to
Workspace, changing the conversation URL, or unregistering the definition also closes the active
Main View.

Every open request also supplies a `LocalizableText` title and may supply a non-empty `breadcrumbs`
path ordered from parent to current page. The Workbench header resolves both at render time, so
built-in extensions should pass `defineMessage(...)` descriptors instead of translated strings.
Every ancestor breadcrumb must define either `params` or `closeView: true` and is rendered as a
keyboard-accessible navigation button; omit both only for the current page. Selecting a `params`
ancestor reopens the same Main View kind with its target params and the shortened breadcrumb path;
selecting a `closeView` ancestor returns to the shell-level parent destination. Do not define both
targets on one item or attach a target to the current item. When breadcrumbs are present, the
shared header treats `title` as the current page label for metadata and fallback behavior. A Main
View title replaces the conversation title only while that view is active.

Main Views own their internal navigation, layout, and i18n. They do not provide URL routing,
resource keys, persistent tabs, scopes, or keep-alive behavior. Use a Next.js route for URL identity
and a Workspace Surface for a persistent, resource-scoped right Inspector.

## Renderer contract

```ts
type MessageRendererComponent = ComponentType<{ node: UserMessageNode | AssistantMessageNode }>;
type ToolRendererComponent = ComponentType<{
  node: UserMessageNode | AssistantMessageNode | SystemNode;
  block: ToolCallBlock;
  fallback: ReactNode;
}>;
type DataRendererComponent = ComponentType<{
  node: UserMessageNode | AssistantMessageNode | SystemNode;
  block: DataBlock;
  fallback: ReactNode;
}>;

context.renderers.message.register({ id, component: MessageRenderer });
context.renderers.blocks.register({ id, canRender, component: MessageBlockRenderer });
context.renderers.tools.register(toolName, ToolRenderer);
context.renderers.data.register(dataName, DataRenderer);
context.renderers.toolPresentations.register(toolName, toolPresentation);
context.renderers.dataPresentations.register(dataName, dataPresentation);
```

The Message Renderer is a singleton contribution that receives the complete User/Assistant Node
and owns its Block grouping and presentation. Only one
can be active; without one, Workbench renders its minimal fallback. Tool and Data renderers compose
under it through `RendererHost` and retain exact, case-sensitive name matching in separate
uniqueness scopes. Predicate-matched Message Block renderers are tried in registration order; the
first match wins. `RendererHost` receives the owning Node, Block, and existing fallback. Renderer
APIs have no numeric `order` or `priority` field.

Tool/Data presentation registries add timeline metadata without replacing the corresponding Block
renderer. Tool presentations provide localizable active/completed labels, an icon, an optional pure
stream-safe summary returning `LocalizableText`, and an optional disclosure controller. An optional
`getActiveLabel` pure function may override the default active label when the running tool has
distinct partial-argument-safe streaming phases. Data presentations can opt a named Data Block into the timeline and provide pure
visibility/activity predicates. Names are exact, case-sensitive, and independently unique from the
Tool/Data renderer registries.

Resolution order:

1. first predicate-matched Message Block Renderer;
2. exact-name Tool/Data Renderer;
3. fallback supplied by the active Message Renderer or Workbench safety renderer.

A Renderer only displays an existing Message Block. It does not define a tool, expose it to a model, execute it, or cause a Data Block to be emitted.

Tool arguments are partial during streaming. Handle `running`, `complete`, `incomplete`,
`requires-action`, and `error`; use `argumentsText` while parsed `arguments` are incomplete. Tool
execution, approval, and resume actions belong to the owning Runtime capability, not Renderer props.

`ToolPresentationDefinition.disclosureController` is an optional component mounted outside the
tool-detail disclosure. It receives the current Tool Block, `running`, `open`, and the host-owned
`onOpenChange`; use it when an extension-owned asynchronous presentation signal—such as a terminal
waiting for input—must reveal a collapsed Tool Renderer. It is presentation-only: do not execute the
tool, duplicate the detail UI, or mutate the Block from this controller.

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
components call `useOpenerService().open(request)` from `@workbench/shell/right-workspace/react` and must
handle rejection in event handlers. Setup never calls a React hook because the service injects
`open/reveal` Surface operations only when executing the handler.

Do not deep-import a sibling `<owner-package>/src/extensions/builtin/<feature>`. Promote genuinely
shared capability contracts to a finite public entry in the owning workspace package, and use the
Opener only for resource ownership/routing.

## RightWorkspace boundary

RightWorkspace is the generic inspector tab host mounted to the right of the Workbench. Concrete
capabilities are Workspace Surface contributions registered through `ExtensionContext.workspace`.

Source of truth:

- `packages/extension-platform/sdk/src/api/workspace-surface.ts`: public contribution, instance, scope, and registry contracts;
- `packages/extension-platform/sdk/src/registries/workspace-surface-registry.ts`: tracked capability registry;
- `apps/web/src/components/right-workspace/index.ts`: Web application facade for product presentation only, including the
  visual workspace, feedback forms/chrome, toggle, and product composition Provider;
- `packages/workbench/shell/src/right-workspace.ts`: finite public entry for generic
  RightWorkspace controller/persistence ports, layout state, selectors, mount/split policy, tabs,
  and resize preview. It does not re-export SDK authoring constants or Workspace Surface contracts;
- `packages/workbench/shell/src/right-workspace/`: implementation of those platform-independent
  primitives; it must not import business extensions, Pi, Next, or a root alias;
- `packages/workbench/shell/src/right-workspace/workspace-controller.ts`: `open`, `reveal`, `focus`,
  `close`, update, layout, restore, hydration arbitration, ordered persistence, and disposal. Product
  settings/localStorage and catalog validation enter only through injected root-owned adapters;
- `packages/workbench/shell/src/right-workspace-react.ts`: finite `./right-workspace/react` entry for
  generic context/hooks, immutable installation Provider, and Surface runtime host. Provider inputs
  are installation-scoped and require a keyed remount to change; the entry exposes selector hooks,
  not the internal environment or raw Store owner;
- `packages/workbench/shell/src/right-workspace/workspace-feedback-*.ts`: runtime-neutral feedback
  store and immutable claim/CAS contract; it does not import an Agent Runtime;
- `apps/web/src/components/right-workspace/right-workspace-provider.tsx`: Web product wrapper injecting settings,
  legacy storage, catalog validation, application context, and opener construction. Product visual
  presentation remains root-owned.

Workspace Surface definitions, instances, scopes, registry, and authoring constants remain direct
imports from `@workbench/extension-sdk`; Shell exports its controller and state contracts without
re-exporting those SDK authoring contracts.

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
mounted once inside the application Runtime provider. Both are optional and owned by the extension.
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

Generic UI belongs to Shell and consumes Workbench conversation projections and optional capability
hooks from `@workbench/agent-runtime-client/context`. Its DTOs and errors come from Workbench
contracts and `@workbench/agent-runtime-client/capabilities`. Missing capabilities hide entries or
produce an unavailable state for restored UI; never branch on Runtime ID or install a fake capability.
Shell, Core, and Extension SDK/Host must not import Pi packages or interpret Pi raw events/errors.

For Pi-specific configuration, resources, and diagnostics inside Pi Contributions, read
`packages/agent-runtime/runtimes/pi/README.md` and verify exact shapes against:

- `@workbench/agent-runtime-pi-protocol/rpc` for unary RPC envelopes and payload/value types;
- `@workbench/agent-runtime-pi-protocol/stream` for mux/host WebSocket frames;
- the owning `@workbench/agent-runtime-pi-client/*` feature facade for browser-side RPC helpers and
  subscribed state.

Pi Client owns authoritative snapshots and deltas through the shared paired mux/host WebSocket
connection; Pi Contributions use the public subscribed hooks and unary helpers. Do not issue raw `fetch()` calls, create a
second WebSocket/SSE connection, duplicate payload interfaces, or treat HTTP `200` as business
success without checking the RPC result envelope.

`/api/pi/**`, legacy contracts, and `legacy-sse.ts` are compatibility paths, not the default for new
features. Use one only when `packages/agent-runtime/runtimes/pi/README.md` explicitly identifies a remaining exception (for
example the current queue-pause compatibility command). If a required method is missing, extend the
wire contracts, validation/router, domain service, client helper, and tests before wiring the UI.
Do not infer unimplemented Harness APIs or bypass the trust boundary from a component.

When the change reaches server-side SDK code, switch references instead of treating the browser
runtime as the package API: use `$pi-coding-agent-sdk` for AgentSession, coding-agent extensions,
resource loading, and `@earendil-works/pi-coding-agent`; use `$pi-ai-sdk` for model/provider/auth,
message/tool schemas, image requests, streaming events, and direct `@earendil-works/pi-ai` work.
Browser extensions consume the resulting Workbench capabilities, or Pi-specific facades inside Pi
Contributions, through the same installed connection.

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

RightWorkspace and `useOpenerService()` hooks come from `@workbench/shell/right-workspace/react`, Workspace
Surface/Open Handler registration comes from `context.workspace`/`context.openers`, and Pi hooks come
from the relevant `@workbench/agent-runtime-pi-client/*` feature facade.

Use the Workbench Agent Runtime hooks for Session state. Message/Block renderers should prefer their
Host-provided `node`/`block` props; do not mirror chat state in a separate extension store.

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
Message block renderer id global within MessageBlockRendererRegistry
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
