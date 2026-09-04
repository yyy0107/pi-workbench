---
name: extend-workbench-ui
description: Builds, modifies, and reviews Pi Workbench frontend extensions using this repository's static Slot, Panel, Command, Composer Command, Opener, Renderer, Settings, Main View, Workspace Surface, and Toolbox metadata platform. Use when adding Workbench UI features, extension components, composer/header/sidebar/statusbar/workspace contributions, inspector surfaces, resource open handlers, panels, settings, command-palette actions or shortcuts, message/part/tool/data renderers or timeline presentations, builtinExtensions or installableComponentExtensions entries, or when deciding whether a change belongs in an extension versus app, workbench, RightWorkspace, browser conversation runtime, Pi runtime, or backend core.
---

# Extend Workbench UI

Implement frontend features through the repository's typed, statically bundled extension platform while preserving Workbench browser/runtime boundaries.

## Load the right context

1. Read the repository `AGENTS.md` and preserve unrelated worktree changes.
2. Read [references/contracts.md](references/contracts.md) before editing extension code.
3. Read [references/recipes.md](references/recipes.md) when implementing a Slot, Panel, Command, Composer Command, Opener, Renderer, Settings, Main View, RightWorkspace integration, Toolbox entry, or new host Slot.
4. If frontend UI reads or mutates Pi host/session/workspace/model state, read [`packages/agent-runtime/runtimes/pi/README.md`](../../../packages/agent-runtime/runtimes/pi/README.md) completely before choosing an API. Then inspect the named contract and client files; do not infer the protocol from legacy routes or a generic Harness reference.
5. Use `$pi-coding-agent-sdk` when work reaches the server-side AgentSession, coding-agent extension, resource-loader, or `@earendil-works/pi-coding-agent` layer. Keep that SDK behind the Workbench Pi server boundary rather than importing it into browser components.
6. Use `$pi-ai-sdk` when work directly uses `@earendil-works/pi-ai` models, providers, authentication, messages, tool schemas, image requests, or streaming events. Use both Pi SDK skills only when the task genuinely crosses both layers.
7. Read `docs/extensions.md` only when the task asks for public documentation or a detailed tutorial.
8. For browser conversation, thread, composer, message, or tool state, inspect the current owner under `packages/agent-runtime/**` and `packages/workbench/shell/**` before editing.
9. Treat remaining assistant-ui code as migration-only compatibility code and follow [`docs/assistant-ui-removal-and-custom-runtime-plan.md`](../../../docs/assistant-ui-removal-and-custom-runtime-plan.md); do not add a new assistant-ui dependency or public type.
10. Route tool definition and execution through the owning Pi/backend capability. A Renderer registration alone does not define or execute a tool.
11. If the task touches Next.js app code, read the relevant local guide in `node_modules/next/dist/docs/` before editing.

## Decide the ownership boundary

Implement the feature as an extension when it can be independently enabled or removed without breaking the core chat flow:

- Use a **Slot** for a small button, badge, control, or status indicator.
- Use a **Panel** for a host-managed left or bottom surface. The current shell does not mount a right Panel host.
- Use a **Command** for an action shared by the command palette, a shortcut, or UI controls.
- Use a **Composer Command** for a structured command token that changes request compilation; it is separate from a global Command.
- Use an **Opener** when one contribution needs to open a resource owned by another without importing its surface kind, component, or store.
- Use a **Renderer** for a complete message presentation, a predicate-matched Message Block, an exact-name Tool/Data Block, or its timeline presentation metadata.
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

- a Next.js route or page assembly: `apps/web/src/app/`;
- reusable shell structure, responsive layout, or a new insertion contract:
  `packages/workbench/shell/src/`; application-only composition stays in `apps/web/src/workbench/`;
- Inspector controller lifecycle, generic persistence, and runtime-neutral feedback claim store:
  `@workbench/shell/right-workspace`;
- Inspector React context/hooks, immutable installation Provider, and generic Surface runtime host:
  `@workbench/shell/right-workspace/react`;
- Inspector product settings/i18n/runtime adapters and visual presentation:
  `apps/web/src/components/right-workspace/` plus `apps/web/src/workbench/providers/`;
- a feature-owned inspector Surface, menu item, Runtime bridge, or single-feature domain service:
  `<owner-package>/src/extensions/builtin/<feature>/`;
- a user-installable, statically trusted component contribution bundle:
  `packages/workbench/shell/src/extensions/installable/<feature>/`;
- a capability consumed by multiple contributions: promote its contract/adapter to the owning
  workspace package's public capability module;
- assistant runtime, persistence, transport, or adapters: the appropriate
  `packages/agent-runtime/**` leaf or application composition Provider;
- shared UI primitives: `packages/workbench/shell/src/ui/`;
- tool definition/execution or protocol behavior: the owning Workbench runtime or backend code.

When no existing Slot fits, add a typed host Slot first, then register the feature against it. Do not invent an unknown Slot name inside a business extension.

## Follow the implementation workflow

### 1. Inspect before editing

- Inspect `packages/extension-platform/sdk/src/authoring.ts`, the relevant type under
  `packages/extension-platform/sdk/src/api/`, and runtime hooks in
  `packages/extension-platform/host/src/index.ts` when a mounted component needs Host state.
- Inspect the owning package's extension groups, then the application composition in
  `apps/web/src/workbench/runtime-contributions/installed-workbench-extensions.ts`.
- Choose the closest builtin example:
  - `connection-status`: minimal Slot;
  - `token-usage`: derive the active browser conversation Runtime state;
  - `workspace-review`, `workspace-explorer`, `workspace-file`, `workspace-browser`, and `workspace-artifact`: Workspace Surface contributions;
  - `skills`: Pi-backed Settings section using a typed unary RPC helper;
  - `terminal`: Workspace Surface, Command, `bash` Renderer, Runtime bridge, and mobile trigger;
  - `workspace-file`: Workspace Surface plus a `file` Open Handler;
  - `settings`: sidebar/header triggers, `shell.overlay`, Command, and extensible settings sections/items;
  - `appearance`: Settings section/item plus `shell.background` contribution;
  - `model-selector`: active model context plus default-model Settings integration;
  - `toolbox`: `sidebar.toolbox` plus a Main View;
  - `generative-ui`: installable Toolbox metadata plus a predicate-matched Message Block Renderer;
  - `message-presentation`, `terminal`, and `image-understanding`: Message Renderer, Tool/Data Renderer, and timeline presentation patterns.
- Check whether the requested id, shortcut, tool name, or data name already exists.
- Search project-wide global `keydown` listeners before assigning a shortcut. Non-Command listeners may accept extra modifiers and still collide with an otherwise exact Command shortcut.

### 2. Create a cohesive feature directory

Prefer this layout for fixed Workbench features and omit files the feature does not need:

```text
<owner-package>/src/extensions/builtin/<feature>/
├── extension.ts
├── <feature>-panel.tsx
├── <feature>-trigger.tsx
├── <feature>-command.ts
├── <feature>-renderer.tsx
└── index.ts
```

For a component extension that users can uninstall, use the same internal layout under
`packages/workbench/shell/src/extensions/installable/<feature>/`, declare
`toolbox.distribution: "installable"`, and add the stable extension object to
`installableComponentExtensions`. Do not place an uninstallable feature under an owner package's
`src/extensions/builtin/`.

Add `"use client"` only to components or modules that use React hooks, events, browser APIs, or client-only Runtime hooks. Keep registration definitions free of render-time side effects.

### 3. Define and register the extension

Define the extension once at module scope:

```ts
import { defineExtension } from "@workbench/extension-sdk";

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

Export a fixed feature from its local `index.ts` and add it to the owning package's semantic group.
Shell groups live in `packages/workbench/shell/src/extensions/builtin-extensions.ts`; Pi groups live
behind `@workbench/agent-runtime-pi-contributions/installation`. The Web application interleaves
those groups only in
`apps/web/src/workbench/runtime-contributions/installed-workbench-extensions.ts`. Export an
uninstallable component extension from
`packages/workbench/shell/src/extensions/installable/<feature>/` and add it to
`installableComponentExtensions` in
`packages/workbench/shell/src/extensions/installable-extensions.ts`; its persisted installation
state determines whether Workbench includes it in the active ExtensionProvider list.

Keep extension objects and catalog array references stable. Installation and uninstallation only
change the application registry and active contributions; the trusted code remains statically
bundled so it can be reinstalled. Do not add directory scanning, remote URL imports, arbitrary
JavaScript loading, or runtime route registration.

### 5. Validate proportionally

Run targeted checks first, using pnpm only:

```bash
pnpm exec oxfmt --check <owner-package>/src/extensions/builtin/<feature> <owner-package>/src/extensions/builtin-extensions.ts
pnpm exec oxlint <owner-package>/src/extensions/builtin/<feature> <owner-package>/src/extensions/builtin-extensions.ts
pnpm exec tsc --noEmit
```

Run `pnpm build` when changing provider composition, public contracts, Workbench hosts, routing, or client/server boundaries.
When changing Pi transport or session behavior, also run the Pi tests documented in `packages/agent-runtime/runtimes/pi/README.md`.

## Enforce the guardrails

- Import extension definitions and contribution contracts from `@workbench/extension-sdk`.
  Mounted components may import public runtime hooks from `@workbench/extension-host`. Only the active
  Message Renderer and shared extension surfaces use the explicitly allowlisted leaf Host entries;
  never import the aggregate `@workbench/extension-host/hosts` entry or registry internals.
- Keep uninstallable component extensions under
  `packages/workbench/shell/src/extensions/installable/`, never an owner package's
  `src/extensions/builtin/`.
- Keep Toolbox component placement previews as a faithful, proportionally scaled reproduction of the current Workbench panorama (sidebar, header, conversation, composer, RightWorkspace, status bar, panels, and global overlays). Reuse the same design tokens and surface hierarchy, and highlight the exact typed target as a non-layout overlay instead of falling back to an abstract empty-box diagram.
- In message placement previews, render concrete system, user, and assistant examples plus representative visible Block states (text, reasoning, tool, data, source, attachment, and error). Give `message.before`, `message.actions`, and `message.after` labeled role-specific examples while active so a valid message Slot never collapses into an invisible strip.
- Never deep-import a sibling `<owner-package>/src/extensions/builtin/<feature>`; collaborate through a public Registry, Renderer, Command, Opener, or promoted Service.
- Localize every new or changed user-visible string, including accessibility text, in co-located `en-US` and `zh-CN` dictionaries. Register `LocalizableText` with `defineMessage(...)` and resolve component copy through the shared i18n API.
- Register component types, not pre-created React nodes.
- Never call `register()` during React render.
- Keep Extension, Panel, Command, Composer Command, Slot contribution, Message Block Renderer, exact-name Renderer/presentation, Settings section/item, Main View, Open Handler, and Workspace Surface identifiers within their documented uniqueness scopes.
- Audit both registered Commands and standalone global keyboard listeners before choosing a shortcut.
- Use `order` only for Slot and Settings contributions. Panel, Command, and Renderer APIs have no numeric priority.
- Treat tool arguments as partial while streaming; guard missing fields and all status variants.
- Do not duplicate messages, composer content, or `isRunning` in Zustand; derive them from the active Workbench Agent Runtime.
- Do not repeat the Panel title bar or close chrome inside Panel content.
- Do not assume registering a Panel opens it; use PanelService or a Command.
- Do not target `defaultLocation: "right"` or `panel.right.*` for new features while the current shell uses RightWorkspace instead of a right Panel host.
- Register inspector kinds only through `context.workspace.register(...)`; keep the kind, icon, resource key, default scope, renderer, optional menu item, Runtime bridge, and domain service in the owning extension.
- Register cross-feature resource handlers through `context.openers.register(...)`; callers use `useOpenerService()` and handle Promise rejection.
- Do not add feature-specific kind branches, icons, services, or Agent tool mappings back to
  `apps/web/src/components/right-workspace/`.
- Do not assume registering a Renderer exposes or executes a model tool.
- Do not call raw Pi endpoints, open another event stream, or copy RPC payload types into an extension. Follow `packages/agent-runtime/runtimes/pi/README.md`, reuse the narrow `@workbench/agent-runtime-pi-client/*` feature facade that owns the capability, and treat `/api/pi/**` as compatibility-only unless the README names an exception. Route server-side coding-agent work through `$pi-coding-agent-sdk` and direct Pi model/provider/stream work through `$pi-ai-sdk`.
- Handle rejected Promises in event handlers; React Error Boundaries do not catch event or arbitrary async errors.
- Keep API keys, secrets, and privileged execution out of frontend extensions.

## Finish with an extension-focused handoff

Report:

- which contribution types were added;
- where the extension is enabled;
- user-visible entry points and shortcuts;
- validation performed;
- deliberate frontend-only limitations, especially persistence or missing backend/tool execution.
