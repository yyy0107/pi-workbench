# Workbench Extension Recipes

Use these patterns as starting points. Adapt ids, labels, styling, and behavior to the requested feature instead of copying blindly.

## Contents

- [Slot-only feature](#slot-only-feature)
- [Slot, Panel, and Command feature](#slot-panel-and-command-feature)
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

export function SessionBadge() {
  const messageCount = useAuiState((state) => state.thread.messages.length);

  return <span aria-label={`${messageCount} messages`}>{messageCount}</span>;
}
```

```ts
// extensions/builtin/session-badge/extension.ts
import { defineExtension } from "@/platform/extensions";

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

import { type ComposerSlotContext, useCommandService } from "@/platform/extensions";

export function NotesTrigger({ isRunning }: ComposerSlotContext) {
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
      Notes
    </button>
  );
}
```

```tsx
// notes-panel.tsx
"use client";

import { useState } from "react";

import type { PanelComponentProps } from "@/platform/extensions";

export function NotesPanel({ panelId, close }: PanelComponentProps) {
  const [value, setValue] = useState("");

  return (
    <section data-panel-id={panelId} className="flex h-full min-h-0 flex-col gap-3 p-3">
      <textarea
        aria-label="Thread notes"
        value={value}
        onChange={(event) => setValue(event.currentTarget.value)}
        className="min-h-0 flex-1 resize-none rounded-lg border p-3"
      />
      <button type="button" onClick={close}>
        Done
      </button>
    </section>
  );
}
```

```ts
// notes-command.ts
import { defineMessage } from "@/i18n";
import type { CommandDefinition } from "@/platform/extensions";

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
import { defineExtension } from "@/platform/extensions";

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
      defaultLocation: "right",
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

An opened Panel whose current location is `"right"` becomes a tab in the Workbench-owned right sidebar. Use the Panel `title` and `icon` for a static label, or register `tabComponent` when the extension needs to own dynamic label content such as a browser page title and favicon. The host supplies the surrounding selection and close controls, so the tab component should render only non-interactive icon/text content. Do not add a duplicate generic expand/collapse control; the host already provides it. Feature-specific commands and triggers may still open or activate their own Panel.

```tsx
"use client";

import type { PanelTabComponentProps } from "@/platform/extensions";

export function BrowserTab({ isActive }: PanelTabComponentProps) {
  const { faviconUrl, pageTitle } = useBrowserStore();

  return (
    <>
      <img src={faviconUrl} alt="" className="size-4 shrink-0" />
      <span className="min-w-0 flex-1 truncate text-left">
        {pageTitle || (isActive ? "浏览器" : "新标签页")}
      </span>
    </>
  );
}
```

```ts
context.panels.register({
  id: "browser",
  tabComponent: BrowserTab,
  tabClassNames: {
    root: ({ isActive }) =>
      isActive ? "max-w-64 rounded-lg bg-sky-500/10" : "max-w-48 rounded-lg",
    trigger: "px-2",
    closeButton: "hover:bg-sky-500/15",
  },
  component: BrowserPanel,
  defaultLocation: "right",
});
```

Keep shared dynamic tab state in the extension's React store/context. Hooks belong in `tabComponent`, never in `setup()`.

`tabClassNames` is merged after the Workbench defaults with `cn()`/`tailwind-merge`; later Tailwind utilities can replace host utilities. Its functions must stay pure and hook-free. For more advanced selectors, the host tab root also exposes `data-panel-id` and `data-state`.

Register one plus-menu item from the same extension when users need to open or reactivate the Panel from the tab row:

```tsx
"use client";

import { type RightPanelAddMenuSlotContext, usePanelService } from "@/platform/extensions";

export function BrowserAddMenuItem({ closeMenu }: RightPanelAddMenuSlotContext) {
  const panels = usePanelService();

  return (
    <button
      type="button"
      role="menuitem"
      onClick={() => {
        panels.open("browser");
        closeMenu();
      }}
    >
      Open browser
    </button>
  );
}
```

```ts
const addMenuItem = context.slots.register("panel.right.add-menu", {
  id: "workbench.browser.right-panel-add-menu",
  order: 30,
  component: BrowserAddMenuItem,
});
```

Use `panel.right.actions` for compact icon-only actions such as refresh, fullscreen, or layout controls. Its component receives `{ activePanelId }`. The host owns the close, plus, and collapse buttons; do not duplicate them inside contributions.

## Message Renderer

Register one complete message presentation when an extension needs to choose part grouping,
reasoning appearance, tool-group chrome, and Tool/Data fallbacks:

```tsx
"use client";

import { groupPartByType, MessagePrimitive } from "@assistant-ui/react";
import { RendererHost } from "@/platform/extensions";

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
Panel, Command, and `bash` renderer together so all terminal UI disposes as one unit.

## Tool Renderer

```tsx
"use client";

import type { ToolCallMessagePartComponent } from "@assistant-ui/react";

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
  if (status.type === "running") {
    return <div>Reading arguments: {argsText || "…"}</div>;
  }
  if (status.type === "requires-action") {
    return <div>Waiting for user action.</div>;
  }
  if (isError || status.type === "incomplete") {
    return <div role="alert">Weather lookup did not complete.</div>;
  }

  return (
    <section className="rounded-lg border p-3">
      <p>{args.city ?? "Unknown city"}</p>
      {result ? (
        <p>
          {result.temperatureC}°C · {result.summary}
        </p>
      ) : (
        <p>No result returned.</p>
      )}
    </section>
  );
};
```

Register it using the exact tool name:

```ts
const renderer = context.renderers.tools.register("get_weather", WeatherRenderer);
```

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

Sidebar Slots are desktop-only. Add a separate `header.*` contribution when the feature requires a
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
- [ ] Use unique ids and exact Renderer names.
- [ ] Audit registered shortcuts and standalone global `keydown` listeners.
- [ ] Return Disposables for external resources.
- [ ] Avoid duplicate Panel chrome.
- [ ] Guard partial streaming tool args.
- [ ] Keep assistant-ui state in assistant-ui.
- [ ] Run targeted oxfmt and oxlint.
- [ ] Run TypeScript; run production build for boundary changes.
