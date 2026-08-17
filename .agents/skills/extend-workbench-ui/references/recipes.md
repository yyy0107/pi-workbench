# Workbench Extension Recipes

Use these patterns as starting points. Adapt ids, labels, styling, and behavior to the requested feature instead of copying blindly.

## Contents

- [Slot-only feature](#slot-only-feature)
- [Slot, Panel, and Command feature](#slot-panel-and-command-feature)
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
import type { CommandDefinition } from "@/platform/extensions";

export const toggleNotesCommand = {
  id: "notes.toggle",
  title: "Toggle Notes",
  description: "Open or close thread notes",
  category: "Panels",
  shortcut: ["Mod", "Shift", "N"],
  run(context) {
    context.panels.toggle("notes");
  },
} satisfies CommandDefinition;
```

```ts
// extension.ts
import { StickyNoteIcon } from "lucide-react";

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
      title: "Notes",
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
