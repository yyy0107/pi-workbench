---
name: extend-workbench-ui
description: Builds, modifies, and reviews Pi Workbench frontend extensions using this repository's static Slot, Panel, Command, Composer Command, Opener, Renderer, Settings, Main View, Workspace Surface, and Toolbox metadata platform. Use when adding Workbench UI features, extension components, composer/header/sidebar/statusbar/workspace contributions, inspector surfaces, resource open handlers, panels, settings, command-palette actions or shortcuts, assistant-ui message/part/tool/data renderers or timeline presentations, builtinExtensions or installableComponentExtensions entries, or when deciding whether a change belongs in an extension versus app, workbench, RightWorkspace, assistant runtime, Pi runtime, or backend core.
---

# Extend Workbench UI

Implement frontend features through the repository's typed, statically bundled extension platform while preserving Workbench and assistant-ui boundaries.

## Load the right context

1. Read the repository `AGENTS.md` and preserve unrelated worktree changes.
2. Read [references/contracts.md](references/contracts.md) before editing extension code.
3. Read [references/recipes.md](references/recipes.md) when implementing a Slot, Panel, Command, Composer Command, Opener, Renderer, Settings, Main View, RightWorkspace integration, Toolbox entry, or new host Slot.
4. If frontend UI reads or mutates Pi host/session/workspace/model state, read [`runtime/pi/README.md`](../../../runtime/pi/README.md) completely before choosing an API. Then inspect the named contract and client files; do not infer the protocol from legacy routes or a generic Harness reference.
5. Use `$pi-coding-agent-sdk` when work reaches the server-side AgentSession, coding-agent extension, resource-loader, or `@earendil-works/pi-coding-agent` layer. Keep that SDK behind the Workbench Pi server boundary rather than importing it into browser components.
6. Use `$pi-ai-sdk` when work directly uses `@earendil-works/pi-ai` models, providers, authentication, messages, tool schemas, image requests, or streaming events. Use both Pi SDK skills only when the task genuinely crosses both layers.
7. Read `docs/extensions.md` only when the task asks for public documentation or a detailed tutorial.
8. Use the project `runtime` skill when changing assistant-ui `useAui`, thread, composer, or Runtime state usage.
9. Use the project `primitives` skill when changing assistant-ui message, composer, or thread composition.
10. Use the project `tools` skill when defining or executing an assistant-ui tool. A Renderer registration alone does not define a tool.
11. If the task touches Next.js app code, read the relevant local guide in `node_modules/next/dist/docs/` before editing.

## Decide the ownership boundary

Implement the feature as an extension when it can be independently enabled or removed without breaking the core chat flow:

- Use a **Slot** for a small button, badge, control, or status indicator.
- Use a **Panel** for a host-managed left or bottom surface. The current shell does not mount a right Panel host.
- Use a **Command** for an action shared by the command palette, a shortcut, or UI controls.
- Use a **Composer Command** for a structured command token that changes request compilation; it is separate from a global Command.
- Use an **Opener** when one contribution needs to open a resource owned by another without importing its surface kind, component, or store.
- Use a **Renderer** for a complete assistant-ui message presentation, a predicate-matched message Part, an exact-name Tool/Data Part, or its timeline presentation metadata.
- Use **Settings** for a navigation section or a feature-owned preference inside the shared floating settings surface.
- Use a **Main View** for a transient feature page that replaces the central conversation without adding URL identity or persistent inspector state.
- Use a **Workspace Surface** contribution for persistent inspector capabilities such as review, explorer, file, browser, and artifact views. RightWorkspace core owns only tabs, layout, scope restoration, persistence, status, and feedback chrome. `workspace.actions` remains its compact toolbar Slot for actions outside a Surface lifecycle.
- Add **Toolbox metadata** only when a real component contribution should be discoverable and previewable in the component-extension catalog. Metadata describes a registered contribution; it does not activate one.
- Combine contribution types inside one extension when they represent one feature.

Keep the sidebar's New Conversation control and thread list in core. Register replaceable product
identity in `sidebar.brand`, optional primary navigation in `sidebar.navigation`, workspace heading
controls in `sidebar.workspace.actions`, the Toolbox section body in `sidebar.toolbox`, and persistent
bottom utilities in `sidebar.footer`; use `sidebar.header`, `sidebar.top`, or `sidebar.bottom` only
when their documented positions fit.

Modify core layers instead when the task changes:

- a Next.js route or page assembly: `app/`;
- shell structure, responsive layout, or a new insertion contract: `workbench/`;
- Inspector tab lifecycle, generic persistence, status, or feedback host: `components/right-workspace/`;
- a feature-owned inspector Surface, menu item, Runtime bridge, or single-feature domain service: `extensions/builtin/<feature>/`;
- a user-installable, statically trusted component contribution bundle: `extensions/installable/<feature>/`;
- a capability consumed by multiple contributions: promote its contract/adapter to `services/` or the appropriate `runtime/` layer;
- assistant runtime, persistence, transport, or adapters: `runtime/`;
- shared UI primitives: `components/ui/`;
- tool definition/execution or protocol behavior: assistant-ui Tool/Runtime or backend code.

When no existing Slot fits, add a typed host Slot first, then register the feature against it. Do not invent an unknown Slot name inside a business extension.

## Follow the implementation workflow

### 1. Inspect before editing

- Inspect `platform/extensions/authoring.ts`, `platform/extensions/index.ts`, and the relevant public API type.
- Inspect `extensions/enabled-extensions.ts`.
- Choose the closest builtin example:
  - `connection-status`: minimal Slot;
  - `token-usage`: derive assistant-ui Runtime state;
  - `workspace-review`, `workspace-explorer`, `workspace-file`, `workspace-browser`, and `workspace-artifact`: Workspace Surface contributions;
  - `skills`: Pi-backed Settings section using a typed unary RPC helper;
  - `terminal`: Workspace Surface, Command, `bash` Renderer, Runtime bridge, and mobile trigger;
  - `workspace-file`: Workspace Surface plus a `file` Open Handler;
  - `settings`: sidebar/header triggers, `shell.overlay`, Command, and extensible settings sections/items;
  - `appearance`: Settings section/item plus `shell.background` contribution;
  - `model-selector`: assistant-ui ModelContext plus default-model Settings integration;
  - `toolbox`: `sidebar.toolbox` plus a Main View;
  - `generative-ui`: installable Toolbox metadata plus a predicate-matched Message Part Renderer;
  - `message-presentation`, `terminal`, and `image-understanding`: Message Renderer, Tool/Data Renderer, and timeline presentation patterns.
- Check whether the requested id, shortcut, tool name, or data name already exists.
- Search project-wide global `keydown` listeners before assigning a shortcut. Non-Command listeners may accept extra modifiers and still collide with an otherwise exact Command shortcut.

### 2. Create a cohesive feature directory

Prefer this layout for fixed Workbench features and omit files the feature does not need:

```text
extensions/builtin/<feature>/
├── extension.ts
├── <feature>-panel.tsx
├── <feature>-trigger.tsx
├── <feature>-command.ts
├── <feature>-renderer.tsx
└── index.ts
```

For a component extension that users can uninstall, use the same internal layout under
`extensions/installable/<feature>/`, declare `toolbox.distribution: "installable"`, and add the
stable extension object to `installableComponentExtensions`. Do not place an uninstallable feature
under `extensions/builtin/`.

Add `"use client"` only to components or modules that use React hooks, events, browser APIs, or client-only assistant-ui hooks. Keep registration definitions free of render-time side effects.

### 3. Define and register the extension

Define the extension once at module scope:

```ts
import { defineExtension } from "@/platform/extensions/authoring";

export const exampleExtension = defineExtension({
  id: "workbench.example",
  name: "Example",
  version: "1.0.0",

  setup(context) {
    const contribution = context.slots.register("header.right", {
      id: "workbench.example.header",
      order: 50,
      component: ExampleControl,
    });

    return contribution;
  },
});
```

Keep `setup()` synchronous. Do not call React hooks in it. Return every custom event listener, timer, subscription, or other external resource as a `Disposable`. Registry registrations are tracked automatically, but return them explicitly to make lifecycle ownership clear.

### 4. Add to the correct static catalog

Export a fixed Workbench feature from its local `index.ts`, import it in
`extensions/enabled-extensions.ts`, and add it to the module-level `builtinExtensions` array. Export
an uninstallable component extension from `extensions/installable/<feature>/` and add it to
`installableComponentExtensions` in `extensions/installable-extensions.ts`; its persisted
installation state determines whether Workbench includes it in the active ExtensionProvider list.

Keep extension objects and catalog array references stable. Installation and uninstallation only
change the application registry and active contributions; the trusted code remains statically
bundled so it can be reinstalled. Do not add directory scanning, remote URL imports, arbitrary
JavaScript loading, or runtime route registration.

### 5. Validate proportionally

Run targeted checks first, using pnpm only:

```bash
pnpm exec oxfmt --check extensions/builtin/<feature> extensions/enabled-extensions.ts
pnpm exec oxlint extensions/builtin/<feature> extensions/enabled-extensions.ts
pnpm exec tsc --noEmit
```

Run `pnpm build` when changing provider composition, public contracts, Workbench hosts, routing, or client/server boundaries.
When changing Pi transport or session behavior, also run the Pi tests documented in `runtime/pi/README.md`.

## Enforce the guardrails

- Import extension definitions and contribution contracts from `@/platform/extensions/authoring`.
  Mounted components may import public runtime hooks from `@/platform/extensions`. Only the active
  Message Renderer and shared extension surfaces use the explicitly allowlisted leaf Host entries;
  never import the aggregate `@/platform/extensions/hosts` entry or registry internals.
- Keep uninstallable component extensions under `extensions/installable/`, never `extensions/builtin/`.
- Keep Toolbox component placement previews as a faithful, proportionally scaled reproduction of the current Workbench panorama (sidebar, header, conversation, composer, RightWorkspace, status bar, panels, and global overlays). Reuse the same design tokens and surface hierarchy, and highlight the exact typed target as a non-layout overlay instead of falling back to an abstract empty-box diagram.
- In message placement previews, render concrete system, user, and assistant examples plus representative visible Part states (text, reasoning, tool, data, source, attachment, audio, generative UI, and error). Give `message.before`, `message.actions`, and `message.after` labeled role-specific examples while active so a valid message Slot never collapses into an invisible strip.
- Never deep-import a sibling `extensions/builtin/<feature>`; collaborate through a public Registry, Renderer, Command, Opener, or promoted Service.
- Localize every new or changed user-visible string, including accessibility text, in co-located `en-US` and `zh-CN` dictionaries. Register `LocalizableText` with `defineMessage(...)` and resolve component copy through the shared i18n API.
- Register component types, not pre-created React nodes.
- Never call `register()` during React render.
- Keep Extension, Panel, Command, Composer Command, Slot contribution, Message Part Renderer, exact-name Renderer/presentation, Settings section/item, Main View, Open Handler, and Workspace Surface identifiers within their documented uniqueness scopes.
- Audit both registered Commands and standalone global keyboard listeners before choosing a shortcut.
- Use `order` only for Slot and Settings contributions. Panel, Command, and Renderer APIs have no numeric priority.
- Treat tool arguments as partial while streaming; guard missing fields and all status variants.
- Do not duplicate `messages`, composer content, or `isRunning` in Zustand; derive them from assistant-ui.
- Do not repeat the Panel title bar or close chrome inside Panel content.
- Do not assume registering a Panel opens it; use PanelService or a Command.
- Do not target `defaultLocation: "right"` or `panel.right.*` for new features while the current shell uses RightWorkspace instead of a right Panel host.
- Register inspector kinds only through `context.workspace.register(...)`; keep the kind, icon, resource key, default scope, renderer, optional menu item, Runtime bridge, and domain service in the owning extension.
- Register cross-feature resource handlers through `context.openers.register(...)`; callers use `useOpenerService()` and handle Promise rejection.
- Do not add feature-specific kind branches, icons, services, or Agent tool mappings back to `components/right-workspace/`.
- Do not assume registering a Renderer exposes or executes a model tool.
- Do not call raw Pi endpoints, open another event stream, or copy RPC payload types into an extension. Follow `runtime/pi/README.md`, reuse `runtime/pi/client/transport/api.ts` or the manager hooks, and treat `/api/pi/**` as compatibility-only unless the README names an exception. Route server-side coding-agent work through `$pi-coding-agent-sdk` and direct Pi model/provider/stream work through `$pi-ai-sdk`.
- Handle rejected Promises in event handlers; React Error Boundaries do not catch event or arbitrary async errors.
- Keep API keys, secrets, and privileged execution out of frontend extensions.

## Finish with an extension-focused handoff

Report:

- which contribution types were added;
- where the extension is enabled;
- user-visible entry points and shortcuts;
- validation performed;
- deliberate frontend-only limitations, especially persistence or missing backend/tool execution.
