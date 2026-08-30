# Workbench Extension Recipes

Use these patterns as starting points. Adapt ids, labels, styling, and behavior to the requested
feature instead of copying blindly. Example translation keys assume the feature first adds matching
co-located `en-US` and `zh-CN` dictionaries; use `defineMessage(...)` for registered metadata and
`useI18n()` for component and accessibility copy.

## Contents

- [Slot-only feature](#slot-only-feature)
- [Slot, Panel, and Command feature](#slot-panel-and-command-feature)
- [Composer Command](#composer-command)
- [Settings contribution](#settings-contribution)
- [Installable Toolbox entry](#installable-toolbox-entry)
- [RightWorkspace integration](#rightworkspace-integration)
- [Pi-backed extension](#pi-backed-extension)
- [Message Renderer](#message-renderer)
- [Tool Renderer](#tool-renderer)
- [Data Renderer](#data-renderer)
- [Sidebar contribution](#sidebar-contribution)
- [Add a new host Slot](#add-a-new-host-slot)
- [Validation checklist](#validation-checklist)

## Slot-only feature

```tsx
// extensions/builtin/session-badge/session-badge.tsx
"use client";

import { useAuiState } from "@assistant-ui/react";

import { useI18n } from "@/i18n";

export function SessionBadge() {
  const { t } = useI18n();
  const messageCount = useAuiState((state) => state.thread.messages.length);

  return (
    <span aria-label={t("extensions.sessionBadge.messageCount", { count: messageCount })}>
      {messageCount}
    </span>
  );
}
```

```ts
// extensions/builtin/session-badge/extension.ts
import { defineExtension } from "@/platform/extensions/authoring";

import { SessionBadge } from "./session-badge";

export const sessionBadgeExtension = defineExtension({
  id: "workbench.session-badge",
  name: "Session Badge",
  version: "1.0.0",

  setup(context) {
    return context.slots.register("statusbar.right", {
      id: "workbench.session-badge.statusbar",
      order: 20,
      component: SessionBadge,
    });
  },
});
```

Use `connection-status` and `token-usage` as the in-repository references.

## Slot, Panel, and Command feature

```tsx
// notes-trigger.tsx
"use client";

import { useI18n } from "@/i18n";
import { useCommandService } from "@/platform/extensions";
import type { ComposerSlotContext } from "@/platform/extensions/authoring";

export function NotesTrigger({ isRunning }: ComposerSlotContext) {
  const { t } = useI18n();
  const commands = useCommandService();

  return (
    <button
      type="button"
      disabled={isRunning}
      onClick={() => {
        void commands.execute("notes.toggle").catch((error) => {
          console.error(error);
        });
      }}
    >
      {t("extensions.notes.open")}
    </button>
  );
}
```

```tsx
// notes-panel.tsx
"use client";

import { useState } from "react";

import { useI18n } from "@/i18n";
import type { PanelComponentProps } from "@/platform/extensions/authoring";

export function NotesPanel({ panelId, close }: PanelComponentProps) {
  const { t } = useI18n();
  const [value, setValue] = useState("");

  return (
    <section data-panel-id={panelId} className="flex h-full min-h-0 flex-col gap-3 p-3">
      <textarea
        aria-label={t("extensions.notes.inputLabel")}
        value={value}
        onChange={(event) => setValue(event.currentTarget.value)}
        className="min-h-0 flex-1 resize-none rounded-lg border p-3"
      />
      <button type="button" onClick={close}>
        {t("extensions.notes.done")}
      </button>
    </section>
  );
}
```

```ts
// notes-command.ts
import { defineMessage } from "@/i18n";
import type { CommandDefinition } from "@/platform/extensions/authoring";

export const toggleNotesCommand = {
  id: "notes.toggle",
  title: defineMessage("extensions.notes.toggleTitle"),
  description: defineMessage("extensions.notes.toggleDescription"),
  category: defineMessage("extensions.shared.panelsCategory"),
  shortcut: ["Mod", "Shift", "N"],
  run(context) {
    context.panels.toggle("notes");
  },
} satisfies CommandDefinition;
```

```ts
// extension.ts
import { StickyNoteIcon } from "lucide-react";

import { defineMessage } from "@/i18n";
import { defineExtension } from "@/platform/extensions/authoring";

import { toggleNotesCommand } from "./notes-command";
import { NotesPanel } from "./notes-panel";
import { NotesTrigger } from "./notes-trigger";

export const notesExtension = defineExtension({
  id: "workbench.notes",
  name: "Notes",
  version: "1.0.0",

  setup(context) {
    const trigger = context.slots.register("composer.actions.left", {
      id: "workbench.notes.composer",
      order: 40,
      component: NotesTrigger,
    });
    const panel = context.panels.register({
      id: "notes",
      title: defineMessage("extensions.notes.title"),
      icon: StickyNoteIcon,
      component: NotesPanel,
      defaultLocation: "left",
      defaultSize: 360,
      minSize: 280,
      maxSize: 640,
    });
    const command = context.commands.register(toggleNotesCommand);

    return [trigger, panel, command];
  },
});
```

Export `notesExtension` from the feature `index.ts`, then add it to `extensions/enabled-extensions.ts`.

Prefer this command-first trigger when the action has a Command. For a trivial Panel toggle, calling `usePanelService().toggle("notes")` directly is also valid.

The current shell mounts Panel hosts at `"left"` and `"bottom"`. Although `"right"`,
`tabComponent`, `tabClassNames`, and `panel.right.*` remain in the compatibility types, the current
shell does not mount a right Panel host. Do not use them for new features. Put persistent inspector
content in RightWorkspace, or use a bottom Panel for an independent drawer such as logs.

If a Panel must always render in one mounted location, move it before opening/toggling so a stale
stored location cannot hide it:

```ts
run(context) {
  context.panels.move("notes", "bottom");
  context.panels.toggle("notes");
}
```

## Composer Command

Register a structured Composer token through `context.composerCommands`; do not confuse it with a
global palette/shortcut Command:

```ts
const reviewCommand = context.composerCommands.register({
  id: "review",
  label: defineMessage("extensions.review.command.label"),
  description: defineMessage("extensions.review.command.description"),
  composer: {
    behavior: "context",
    effect: "context-provider",
    scope: "message",
    apply(draft) {
      draft.context.push({ type: "review", value: true });
    },
  },
});
```

`apply()` is synchronous and runs against a request-scoped draft. Use `behavior`, `effect`,
`exclusive`, `group`, and `scope` to describe composition instead of inspecting editor DOM state.
For a structured parameter panel, add an `argsSchema` plus `argsBinding: { kind: "message-text",
field, consumeText }`; bound commands must be message-scoped and exclusive. Command ids are global
within `ComposerCommandRegistry`.

## Settings contribution

Let the shared settings extension own its floating surface, navigation, headings, and separators. A feature
registers only the section it owns or an item inside an existing section:

```ts
const section = context.settings.registerSection({
  id: "general",
  title: defineMessage("extensions.settings.general.title"),
  group: {
    id: "basics",
    title: defineMessage("extensions.settings.groups.basics"),
  },
  headerAction: GeneralSettingsAction,
  order: 0,
});

const item = context.settings.registerItem({
  sectionId: "general",
  id: "language",
  title: defineMessage("extensions.localeSelector.languageTitle"),
  description: defineMessage("extensions.localeSelector.languageDescription"),
  component: LocaleSettingsItem,
  order: 10,
});

return [section, item];
```

Use `headerAction` for a compact feature-owned control that belongs beside the section heading, such
as resetting the current section. The Host owns its placement and error isolation; the component
receives `{ sectionId }` and may use Hooks. Settings items may also use Hooks and browser APIs in
their client component. Sections with the same stable `group.id` share one localizable navigation
heading. Give every item a localizable `title`; add a `description` and aliases in `keywords` when
the component represents controls users may search for under different names. The shared Host uses
this metadata to render project-level search results and focus the selected item. Keep preference
state and persistence with the feature that owns the item. Do not register
during render or import the concrete Settings registry implementation. Items may register before
their section appears.

Use `extensions/builtin/settings` for the shell and
`extensions/builtin/locale-selector` for an independently owned item.

## Installable Toolbox entry

Toolbox metadata describes an actual registered component contribution. For an uninstallable,
statically trusted bundle, keep the feature under `extensions/installable/`, align metadata with the
real registration, and list the stable extension object in `installableComponentExtensions`:

```ts
export const generativeUiExtension = defineExtension({
  id: "workbench.generative-ui",
  name: "Generative UI",
  version: "1.0.0",
  toolbox: {
    kind: "component-extension",
    distribution: "installable",
    name: defineMessage("extensions.generativeUi.name"),
    description: defineMessage("extensions.generativeUi.description"),
    entryFile: "extensions/installable/generative-ui/extension.ts",
    contributions: [
      {
        id: "workbench.generative-ui.message-part",
        kind: "message-part-renderer",
        surface: defineMessage("extensions.generativeUi.placement.surface"),
        target: "context.renderers.parts",
        host: "MessagePrimitive.Parts → MessagePartRendererHost",
        description: defineMessage("extensions.generativeUi.placement.description"),
        preview: GenerativeUIPreview,
        sourceFiles: [
          "extensions/installable/generative-ui/generative-ui-renderer.tsx",
          "extensions/installable/generative-ui/generative-ui-spec.ts",
        ],
      },
    ],
  },
  setup(context) {
    return context.renderers.parts.register({
      id: "workbench.generative-ui.message-part",
      canRender: canRenderGenerativeUIPart,
      component: GenerativeUIRenderer,
    });
  },
});
```

The preview is a no-props component that uses the real design system and representative safe state;
it must not execute tools, call privileged APIs, or depend on an active Runtime scope. Use the
project-relative implementation paths for `entryFile` and `sourceFiles`. Builtin features may expose
the same metadata with `distribution: "builtin"`, but remain in `builtinExtensions`.

## RightWorkspace integration

RightWorkspace core owns only the inspector layout and tab lifecycle. Register each concrete
capability as a Workspace Surface contribution:

```ts
import { FileTextIcon } from "lucide-react";

import { defineExtension, type WorkspaceSurfaceDefinition } from "@/platform/extensions/authoring";

import { NotesMenuItem } from "./notes-menu-item";
import { NotesRuntimeBridge } from "./notes-runtime-bridge";
import { NotesSurface, type NotesSurfaceParams } from "./notes-surface";

const notesSurface = {
  kind: "notes",
  icon: FileTextIcon,
  cachePolicy: "keep-alive",
  persistence: "persistent",
  defaultPlacement: "primary",
  allowDuplicateResources: false,
  getResourceKey: (params, context) => `notes:${context.threadId}:${params.id}`,
  getDefaultScope: (_params, context) => ({
    type: context.threadId ? "thread" : "application",
    key: context.threadId ?? context.applicationId,
  }),
  render: NotesSurface,
  menuItem: NotesMenuItem,
  runtime: NotesRuntimeBridge,
} satisfies WorkspaceSurfaceDefinition<NotesSurfaceParams>;

export const notesExtension = defineExtension({
  id: "workbench.notes",
  name: "Notes",
  version: "1.0.0",
  setup(context) {
    return context.workspace.register(notesSurface);
  },
});
```

The extension owns its typed params, renderer, menu item, Runtime mapping, domain service, and i18n.
The core host supplies tabs, resource-key deduplication, cache-policy mounting, scope restoration,
persistence, status, and feedback chrome. Use `workspace.actions` only for compact actions outside a
Surface lifecycle. Use `workspace.empty.actions` only for a compact launch action shown when the
Inspector has no Surface; it receives `{ isOpen }` and does not replace Surface registration.

When another contribution needs to open this Surface's resource, let the owner register an Open
Handler and keep its `kind` private to the owning feature:

```ts
const opener = context.openers.register({
  id: "workspace.notes",
  canOpen: ({ resource }) => (resource.scheme === "notes" ? 100 : 0),
  open: ({ resource, context, scope, policy }, { surfaces }) =>
    surfaces.reveal({
      kind: "notes",
      title: resource.label ?? resource.path,
      params: { id: resource.path },
      context,
      ...(scope ? { scope } : {}),
      policy,
    }),
});
```

Client callers obtain `useOpenerService()` from `@/components/right-workspace` and handle the
Promise returned by `open()`. Do not import the owner's component, store, or internal service.

## Pi-backed extension

Before adding Pi-backed UI, read `runtime/pi/README.md` completely and inspect the exact source file
it names. Prefer:

- `usePiThreadStateSnapshot()` or `usePiThreadStates()` from
  `@workbench/agent-runtime-pi-client/threads`, and `usePiWorkspaces()` from
  `@workbench/agent-runtime-pi-client/workspace`, for subscribed state;
- an existing helper from the owning `@workbench/agent-runtime-pi-client/*` feature facade for unary RPC;
- shared types from `@workbench/agent-runtime-pi-protocol/rpc` or
  `@workbench/agent-runtime-pi-protocol/stream`.

Do not write raw `/api/pi/**` or `/api/<method>` fetches in a component, open a second WebSocket/SSE
connection, or copy payload shapes into the extension. The shared manager already owns mux/host
WebSocket generations and revalidation. Legacy routes are compatibility-only unless the runtime
README explicitly documents a remaining exception. If no helper or method exists, extend contracts,
server validation/domain handling, client helper, and tests before adding UI.

If implementing the missing capability requires direct server-side SDK work, use the matching
specialist skill and keep the result behind the Workbench transport boundary:

- use `$pi-coding-agent-sdk` for AgentSession, coding-agent extensions, resource loading, tools,
  commands, and `@earendil-works/pi-coding-agent` public types;
- use `$pi-ai-sdk` for model/provider/auth collections, Pi AI messages, tool schemas, image requests,
  streaming events, or direct `@earendil-works/pi-ai` imports.

Use both only when a coding-agent feature also changes its lower-level Pi AI behavior. Browser
components continue to use the typed Workbench manager/contracts/client helpers rather than either
server package directly.

## Message Renderer

Register one complete message presentation when an extension needs to choose part grouping,
reasoning appearance, tool-group chrome, and Tool/Data fallbacks:

```tsx
"use client";

import { groupPartByType, MessagePrimitive } from "@assistant-ui/react";
import { RendererHost } from "@/platform/extensions/hosts/renderer-host";

export function CompactMessageRenderer() {
  return (
    <MessagePrimitive.GroupedParts
      groupBy={groupPartByType({
        reasoning: ["group-reasoning"],
        "tool-call": ["group-tool"],
      })}
    >
      {({ part, children }) => {
        if (part.type === "group-reasoning") return <details>{children}</details>;
        if (part.type === "group-tool") return <section>{children}</section>;
        if (part.type === "text" || part.type === "reasoning") return <p>{part.text}</p>;
        if (part.type === "tool-call" || part.type === "data") {
          return <RendererHost part={part} />;
        }
        return null;
      }}
    </MessagePrimitive.GroupedParts>
  );
}
```

```ts
const renderer = context.renderers.message.register({
  id: "workbench.compact-message",
  component: CompactMessageRenderer,
});
```

Only one Message Renderer can be active. Keep exact-name Tool/Data renderers in their capability
extensions and resolve them with `RendererHost`; for example a terminal extension can register its
Workspace Surface, Command, and `bash` renderer together so all terminal UI disposes as one unit.

## Tool Renderer

```tsx
"use client";

import type { ToolCallMessagePartComponent } from "@assistant-ui/react";

import { useI18n } from "@/i18n";

interface WeatherArgs {
  city?: string;
}

interface WeatherResult {
  temperatureC: number;
  summary: string;
}

export const WeatherRenderer: ToolCallMessagePartComponent<WeatherArgs, WeatherResult> = ({
  args,
  argsText,
  result,
  status,
  isError,
}) => {
  const { t } = useI18n();

  if (status.type === "running") {
    return <div>{t("extensions.weather.readingArguments", { args: argsText || "…" })}</div>;
  }
  if (status.type === "requires-action") {
    return <div>{t("extensions.weather.waitingForAction")}</div>;
  }
  if (isError || status.type === "incomplete") {
    return <div role="alert">{t("extensions.weather.incomplete")}</div>;
  }

  return (
    <section className="rounded-lg border p-3">
      <p>{args.city ?? t("extensions.weather.unknownCity")}</p>
      {result ? (
        <p>
          {result.temperatureC}°C · {result.summary}
        </p>
      ) : (
        <p>{t("extensions.weather.noResult")}</p>
      )}
    </section>
  );
};
```

Register it using the exact tool name:

```ts
const renderer = context.renderers.tools.register("get_weather", WeatherRenderer);
```

When a tool can asynchronously require user attention while its detail is collapsed, register a
presentation-owned disclosure controller instead of hard-coding the tool name into the Message
Renderer:

```tsx
const disclosureController: ToolPresentationDisclosureController = ({
  part,
  running,
  open,
  onOpenChange,
}) => {
  const needsAttention = useToolAttention(part.toolCallId, running && !open);

  useEffect(() => {
    if (needsAttention && !open) onOpenChange(true);
  }, [needsAttention, onOpenChange, open]);

  return null;
};
```

Register the component through `context.renderers.toolPresentations`; the host keeps it outside the
collapsed detail and preserves its scroll-compensated disclosure behavior. The controller may
observe presentation state, but it must not execute the tool or duplicate the registered Tool
Renderer.

Also define/expose the actual `get_weather` tool through the appropriate assistant-ui Tool/Runtime/backend path. Renderer registration is presentation-only.

## Data Renderer

```tsx
"use client";

import type { DataMessagePartComponent } from "@assistant-ui/react";

interface CitationData {
  label: string;
  url: string;
}

export const CitationRenderer: DataMessagePartComponent<CitationData> = ({ data }) => {
  const safeUrl = /^https?:\/\//i.test(data.url);

  if (!safeUrl) return <span>{data.label}</span>;

  return (
    <a href={data.url} target="_blank" rel="noopener noreferrer">
      {data.label}
    </a>
  );
};
```

```ts
const renderer = context.renderers.data.register("citation", CitationRenderer);
```

The Runtime or transport must emit a data Part whose `name` is exactly `citation`.

## Sidebar contribution

Keep optional product areas out of the core sidebar. Register replaceable product identity in
`sidebar.brand`, primary destinations such as agents, assets, or toolboxes in
`sidebar.navigation`, compact Workspace heading controls in `sidebar.workspace.actions`, and
persistent utilities in `sidebar.footer`. The host owns layout, so the contribution should render
one control and should not add outer padding or section chrome.

Use `extensions/builtin/workbench-brand` as the minimal `sidebar.brand` reference. Keep one active
brand contribution in normal configurations; multiple contributions render in Slot order.

```ts
const navigation = context.slots.register("sidebar.navigation", {
  id: "workbench.assets.navigation",
  order: 30,
  component: AssetsNavigationItem,
});
```

`sidebar.workspace.actions` also mounts in the mobile conversation Sheet. The other Sidebar Slots
are desktop-only, so add a separate `header.*` contribution when one of those features requires a
mobile entry point. Do not replace the core New Conversation control or thread list from an
extension.

## Add a new host Slot

Use this only when no existing host contract can represent a broadly reusable insertion point.

1. Add the literal name to `WORKBENCH_SLOTS` in `platform/extensions/api/slot.ts`.
2. Add its props to `SlotPropsMap`.
3. Mount `SlotHost` in the appropriate `workbench/` component.
4. Supply the typed context expected by `SlotPropsMap`.
5. Add or update the public extension guide.

```ts
// platform/extensions/api/slot.ts
export interface SlotPropsMap {
  // existing slots...
  "thread.toolbar": { threadId?: string };
}
```

```tsx
<SlotHost name="thread.toolbar" context={{ threadId }} className="flex items-center gap-2" />
```

Do not add a feature-specific Slot such as `notes.button`. Add a semantic host location that can support multiple independent contributions.

## Validation checklist

- [ ] Use pnpm only.
- [ ] Keep unrelated dirty worktree changes intact.
- [ ] Import only the extension public surface.
- [ ] Keep the extension object and enabled array stable.
- [ ] Localize component copy and accessibility text in co-located `en-US` and `zh-CN` dictionaries.
- [ ] Use unique ids and exact Renderer/presentation names within their documented scopes.
- [ ] Keep Settings section ids global and item ids unique within their section.
- [ ] Keep Toolbox metadata aligned with the actual contribution, preview, and source paths.
- [ ] Register inspector kinds through `context.workspace`; keep feature branches and services out of RightWorkspace core.
- [ ] Register cross-feature resource routing through `context.openers`; do not deep-import sibling builtin features.
- [ ] Use `workspace.actions`/`workspace.empty.actions` only for compact controls outside a Surface lifecycle.
- [ ] Read `runtime/pi/README.md` before Pi-backed UI and route server SDK work through `$pi-coding-agent-sdk` or `$pi-ai-sdk`.
- [ ] Audit registered shortcuts and standalone global `keydown` listeners.
- [ ] Return Disposables for external resources.
- [ ] Avoid duplicate Panel chrome.
- [ ] Use only currently mounted Panel locations; do not target the unmounted right Panel host.
- [ ] Guard partial streaming tool args.
- [ ] Keep assistant-ui state in assistant-ui.
- [ ] Run targeted oxfmt and oxlint.
- [ ] Run TypeScript; run production build for boundary changes.
