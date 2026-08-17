# Workbench Extension Contracts

Use this reference to verify the current first-version public API before implementing an extension.

## Contents

- [Public boundary](#public-boundary)
- [Extension lifecycle](#extension-lifecycle)
- [Slot contract](#slot-contract)
- [Panel contract](#panel-contract)
- [Command contract](#command-contract)
- [Renderer contract](#renderer-contract)
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
  type CommandDefinition,
  type ComposerSlotContext,
  type PanelComponentProps,
} from "@/platform/extensions";
```

Source of truth:

- `platform/extensions/index.ts`
- `platform/extensions/api/`
- `platform/extensions/extension-context.ts`

Business extensions must not import concrete registries, stores, or hosts.

## Extension lifecycle

```ts
interface ExtensionContext {
  readonly slots: SlotRegistry;
  readonly panels: PanelRegistry;
  readonly commands: CommandRegistry;
  readonly renderers: RendererRegistry;
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
sidebar.brand
sidebar.header
sidebar.navigation
sidebar.workspace.actions
sidebar.top
sidebar.bottom
sidebar.footer
thread.header
thread.before
thread.after
message.before
message.after
message.actions
composer.before
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

interface SlotPropsMap {
  "thread.header": { threadId?: string };
  "thread.before": { threadId?: string };
  "thread.after": { threadId?: string };
  "message.before": MessageSlotContext;
  "message.after": MessageSlotContext;
  "message.actions": MessageSlotContext;
  "composer.before": ComposerSlotContext;
  "composer.actions.left": ComposerSlotContext;
  "composer.actions.right": ComposerSlotContext;
  "composer.after": ComposerSlotContext;
  // Header, Sidebar, and Statusbar slots use Record<never, never>.
}
```

Contribution shape:

```ts
interface SlotContribution<K extends WorkbenchSlot> {
  id: string;
  component: ComponentType<SlotPropsMap[K]>;
  order?: number;
}
```

Slot `order` defaults to `0`, sorts ascending, and preserves registration order for ties. Contribution id is unique within one Slot.

Sidebar positions are semantic:

- `sidebar.brand`: replaceable product identity at the top of the sidebar;
- `sidebar.header`: optional compact controls below the brand;
- `sidebar.navigation`: optional primary navigation directly after the core New Conversation control;
- `sidebar.workspace.actions`: compact controls on the right side of the Workspace heading;
- `sidebar.top`: contextual content above the core thread list;
- `sidebar.bottom`: contextual content below the core thread list;
- `sidebar.footer`: persistent bottom utilities.

The mobile conversation Sheet does not mount `sidebar.*` Slots. Add a suitable mobile `header.*` contribution when the feature needs a touch entry point.

## Panel contract

```ts
type PanelLocation = "left" | "right" | "bottom";

interface PanelComponentProps {
  panelId: string;
  close(): void;
}

interface PanelDefinition {
  id: string;
  title: string;
  icon?: LucideIcon;
  component: ComponentType<PanelComponentProps>;
  defaultLocation: PanelLocation;
  defaultSize?: number;
  minSize?: number;
  maxSize?: number;
}
```

Sizes are pixels. Registration only defines a Panel; it does not open it. Workbench supplies the outer title, icon, close button, resize handle, and error boundary.

Only one Panel is active per location. Size is stored per location, not per Panel, and is not persisted across reloads in v1.

## Command contract

```ts
interface CommandDefinition {
  id: string;
  title: string;
  description?: string;
  category?: string;
  icon?: LucideIcon;
  shortcut?: readonly string[];
  run(context: CommandExecutionContext): void | Promise<void>;
}

interface CommandExecutionContext {
  panels: {
    open(panelId: string): void;
    close(panelId: string): void;
    toggle(panelId: string): void;
  };
  navigation: {
    newThread(): void;
    openThread(threadId: string): void;
  };
}
```

Registered commands appear in the `Mod+K` palette. Shortcut tokens support `Mod`/`CmdOrCtrl`, Ctrl, Meta/Cmd, Alt/Option, Shift, and exactly one normal key. Modifier matching inside `CommandService` is exact. Shortcut conflicts resolve to the first registered command, so avoid conflicts explicitly.

Also search standalone global `keydown` listeners outside `CommandService`. For example, the sidebar's `Mod+B` listener accepts `Mod+Shift+B` because it does not reject extra modifiers, so that combination would trigger both features.

## Renderer contract

```ts
type ToolRendererComponent = ToolCallMessagePartComponent;
type DataRendererComponent = DataMessagePartComponent;

context.renderers.tools.register(toolName, ToolRenderer);
context.renderers.data.register(dataName, DataRenderer);
```

Names are exact and case-sensitive. Tool and Data registries have separate uniqueness scopes. Renderer APIs have no `order` or `priority` field.

Resolution order:

1. exact-name extension Renderer;
2. Part-provided `toolUI` or `dataRendererUI`;
3. Workbench fallback;
4. `RendererHost` children.

A Renderer only displays an existing message Part. It does not define a tool, expose it to a model, execute it, or cause a data Part to be emitted.

Tool args are partial during streaming. Handle `running`, `complete`, `incomplete`, and `requires-action` as applicable. Tool renderer props can expose `addResult()`, `resume()`, and `respondToApproval()`; call them only in the matching Runtime state.

## Services available to components

Use hooks inside client components:

```ts
const panels = usePanelService();
const commands = useCommandService();
const navigation = useNavigationService();
```

PanelService provides:

```text
open, close, toggle, activate, move, setSize
isOpen, getActivePanelId, getSize, getLocation
```

CommandService `execute(id)` returns a Promise. Catch rejection when invoking it from an event handler.

Use `useAui()` and `useAuiState()` for assistant-ui Runtime state. Do not mirror chat state in a separate extension store.

## Uniqueness and ordering

```text
Extension id          global within ExtensionManager
Slot contribution id unique within one Slot
Panel id              global within PanelRegistry
Command id            global within CommandRegistry
Tool renderer name    unique within Tool RendererRegistry
Data renderer name    unique within Data RendererRegistry
```

Only Slots have numeric ordering. The module-level `enabledExtensions` order determines activation order, same-order Slot ties, conflicting shortcut selection, and command display order within a category.

Slot, Panel, and Command definitions are copied and shallow-frozen at registration. Dispose and register a replacement instead of mutating registered data.

## Error isolation

Slot, Panel, and Renderer contributions receive separate React Error Boundaries. Setup failures are reported and rolled back. Palette/keyboard Command execution reports rejected Promises.

React Error Boundaries do not catch event-handler errors or arbitrary asynchronous failures. Handle those locally or route them through the extension environment.
