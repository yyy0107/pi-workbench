# Workbench Extension Contracts

Use this reference to verify the current first-version public API before implementing an extension.

## Contents

- [Public boundary](#public-boundary)
- [Extension lifecycle](#extension-lifecycle)
- [Slot contract](#slot-contract)
- [Panel contract](#panel-contract)
- [Command contract](#command-contract)
- [Composer Command contract](#composer-command-contract)
- [Settings contract](#settings-contract)
- [Renderer contract](#renderer-contract)
- [RightWorkspace boundary](#rightworkspace-boundary)
- [Pi runtime boundary](#pi-runtime-boundary)
- [Services available to components](#services-available-to-components)
- [Uniqueness and ordering](#uniqueness-and-ordering)
- [Error isolation](#error-isolation)

## Public boundary

Import from the barrel:

```ts
import {
  defineExtension,
  useCommandService,
  useNavigationService,
  usePanelService,
  useSettingsRegistry,
  type CommandDefinition,
  type ComposerSlotContext,
  type PanelComponentProps,
  type WorkspaceActionsSlotContext,
  type WorkspaceSurfaceDefinition,
} from "@/platform/extensions";
```

Source of truth:

- `platform/extensions/index.ts`
- `platform/extensions/api/`
- `platform/extensions/extension-context.ts`

Business extensions must not import concrete registries, stores, or hosts. Workspace Surface
registration is part of `ExtensionContext`; RightWorkspace controller hooks and Pi runtime remain
separate public boundaries described below.

## Extension lifecycle

```ts
interface ExtensionContext {
  readonly slots: SlotRegistry;
  readonly panels: PanelRegistry;
  readonly commands: CommandRegistry;
  readonly renderers: RendererRegistry;
  readonly settings: SettingsRegistry;
  readonly workspace: WorkspaceSurfaceRegistry;
}

type ExtensionSetupResult = void | Disposable | readonly Disposable[];

interface WorkbenchExtension {
  id: string;
  name: string;
  version: string;
  setup(context: ExtensionContext): ExtensionSetupResult;
}
```

`defineExtension()` preserves literal types; ExtensionManager performs runtime validation and activation. `setup()` is synchronous. Setup failure rolls back registrations. Deactivation disposes resources in reverse order.

Define extension objects at module scope. ExtensionProvider compares object identity when synchronizing the static array.

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
sidebar.workspace.actions
sidebar.top
sidebar.bottom
sidebar.footer
panel.right.add-menu
panel.right.actions
workspace.actions
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

interface SlotPropsMap {
  "shell.background": Record<never, never>;
  "shell.overlay": Record<never, never>;
  "panel.right.add-menu": RightPanelAddMenuSlotContext;
  "panel.right.actions": RightPanelActionsSlotContext;
  "workspace.actions": WorkspaceActionsSlotContext;
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
  // Header, shell, Sidebar, and Statusbar slots use Record<never, never>.
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
- `sidebar.navigation`: optional primary navigation directly after the core New Conversation control;
- `sidebar.workspace.actions`: compact controls on the right side of the Workspace heading;
- `sidebar.top`: contextual content above the core thread list;
- `sidebar.bottom`: contextual content below the core thread list;
- `sidebar.footer`: persistent bottom utilities.

The mobile conversation Sheet mounts `sidebar.workspace.actions`, but not `sidebar.brand`,
`sidebar.header`, `sidebar.navigation`, `sidebar.top`, `sidebar.bottom`, or `sidebar.footer`. Add a
suitable mobile `header.*` contribution when a desktop-only Sidebar contribution also needs a touch
entry point.

`panel.right.add-menu` and `panel.right.actions` remain declared for the legacy right PanelDock, but
the current shell does not mount a right Panel host. Do not use them for new entry points. The
current inspector toolbar mounts `workspace.actions`; contributions receive
`{ activeSurfaceId?, isOpen }` and should render one compact, accessible control. Use it for external
resources such as Terminal. Inspector capabilities are registered separately through
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

Only one Panel is active per location. Size is stored per location, not per Panel, and is not persisted across reloads in v1. Although `PanelLocation` still includes `"right"`, the current shell mounts Panel hosts only for `"left"` and `"bottom"`; a Panel moved to `"right"` has no visible host. New persistent inspector content belongs in RightWorkspace. The terminal is the canonical bottom Panel example and explicitly calls `move(panelId, "bottom")` before toggling so stale stored locations cannot hide it.

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
  order?: number;
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

Section ids are globally unique. Item ids are unique within one section. Sections and items sort by
ascending `order`, preserving registration order for ties. An item may register before its target
section so static extension activation order does not create a dependency. The settings Host owns
navigation, headings, scrolling, separators, and error isolation; item components own their
preference UI, state, and persistence.

Use `useSettingsRegistry()` only in the shared settings Host or tooling that needs subscribed
snapshots. Business extensions should register contributions synchronously in `setup()`.

## Renderer contract

```ts
type ToolRendererComponent = ToolCallMessagePartComponent;
type DataRendererComponent = DataMessagePartComponent;

context.renderers.message.register({ id, component: MessageRenderer });
context.renderers.tools.register(toolName, ToolRenderer);
context.renderers.data.register(dataName, DataRenderer);
```

The Message Renderer is a singleton contribution that owns `MessagePrimitive.Parts` or
`MessagePrimitive.GroupedParts`, including reasoning/tool/data grouping and presentation. Only one
can be active; without one, Workbench renders its minimal fallback. Tool and Data renderers compose
under it through `RendererHost` and retain exact, case-sensitive name matching in separate
uniqueness scopes. Renderer APIs have no `order` or `priority` field.

Resolution order:

1. exact-name extension Renderer;
2. Part-provided `toolUI` or `dataRendererUI`;
3. fallback supplied by the active Message Renderer, or the Workbench safety fallback;
4. `RendererHost` children.

A Renderer only displays an existing message Part. It does not define a tool, expose it to a model, execute it, or cause a data Part to be emitted.

Tool args are partial during streaming. Handle `running`, `complete`, `incomplete`, and `requires-action` as applicable. Tool renderer props can expose `addResult()`, `resume()`, and `respondToApproval()`; call them only in the matching Runtime state.

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
  getResourceKey: (params, workspaceContext) =>
    `example:${workspaceContext.projectId}:${params.id}`,
  getDefaultScope: (_params, workspaceContext) => ({
    type: "project",
    key: workspaceContext.projectId ?? workspaceContext.applicationId,
  }),
  render: ExampleSurface,
  menuItem: ExampleMenuItem,
  runtime: ExampleRuntimeBridge,
});
```

`kind` is globally unique. `menuItem` is rendered in the core add-surface menu and `runtime` is
mounted once inside AssistantRuntimeProvider. Both are optional and owned by the extension.
Registration is tracked and removed on rollback/deactivation.

RightWorkspace core treats `kind` as an opaque stable id. It does not contain capability maps,
feature icons, domain services, or Agent tool mappings. Persisted instances survive while a
definition is unavailable and render again if the extension returns. Use `useRightWorkspace()` and
`useWorkspaceContext()` inside client contributions to open a registered kind; do not call hooks
from setup.

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

RightWorkspace hooks come from `@/components/right-workspace`, Workspace Surface registration comes
from `context.workspace`, and Pi manager hooks come from `@/runtime/pi/client/runtime/context`.

Use `useAui()` and `useAuiState()` for assistant-ui Runtime state. Do not mirror chat state in a separate extension store.

## Uniqueness and ordering

```text
Extension id          global within ExtensionManager
Slot contribution id unique within one Slot
Panel id              global within PanelRegistry
Command id            global within CommandRegistry
Settings section id   global within SettingsRegistry
Settings item id      unique within one settings section
Message renderer      one active within Message RendererRegistry
Tool renderer name    unique within Tool RendererRegistry
Data renderer name    unique within Data RendererRegistry
Workspace surface kind global within WorkspaceSurfaceRegistry
```

Slots and Settings sections/items have numeric ordering. The module-level `enabledExtensions` order determines activation order, same-order ties across extension registrations, conflicting shortcut selection, and command display order within a category.

Slot, Panel, Command, Settings, and Workspace Surface definitions are copied and shallow-frozen at registration. Dispose and register a replacement instead of mutating registered data.

## Error isolation

Slot, Panel, Settings item, Renderer, and Workspace Surface contributions receive separate React Error Boundaries. Setup failures are reported and rolled back. Palette/keyboard Command execution reports rejected Promises.

React Error Boundaries do not catch event-handler errors or arbitrary asynchronous failures. Handle those locally or route them through the extension environment.
