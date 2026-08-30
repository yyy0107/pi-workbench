---
name: pi-coding-agent-sdk
description: Use the embedded @earendil-works/pi-coding-agent SDK and Pi extension system in this Workbench repository. Use when Codex needs to create or change an ExtensionFactory or InlineExtension, subscribe to Pi lifecycle/model/message/tool/input events, register Pi tools/commands/providers/renderers, load or filter extensions through DefaultResourceLoader, work with LoadExtensionsResult or ExtensionRuntime, create/bind/reload AgentSession services, or decide how Pi server state should cross the Workbench RPC boundary. Also use when the Pi adapter packages depend on the Pi coding-agent public API.
---

# Pi Coding Agent SDK

Use Pi coding-agent's public SDK as the backend capability layer for Workbench. Keep Pi runtime objects on the server and adapt only stable, serializable state through the existing Workbench RPC and stream contracts.

## Load the right context

1. Read the repository `AGENTS.md` and the nearest nested instructions for every file being changed.
2. Read `runtime/pi/README.md` completely before changing Pi session, transport, workspace, model, settings, package, skill, or extension behavior.
3. Read [references/source-routing.md](references/source-routing.md) before choosing or importing a Pi API. Resolve the installed package version first.
4. Read [references/extensions.md](references/extensions.md) when authoring, registering, loading, filtering, or debugging Pi extensions.
5. Read [references/session-sdk.md](references/session-sdk.md) when creating sessions/services, binding extension contexts, reloading resources, or exposing Pi behavior to Workbench.
6. If the change also creates a Workbench frontend contribution, use the `extend-workbench-ui` skill for the UI ownership boundary. If it changes assistant-ui Runtime state, also use the `runtime` skill.

## Follow the implementation workflow

### 1. Establish the versioned API surface

- Inspect `package.json` and the resolved `node_modules/@earendil-works/pi-coding-agent/package.json`.
- Treat the installed package's `dist/*.d.ts` and bundled docs as authoritative for code compiled in this repository.
- Use `/home/wy/projects/pi/packages/coding-agent/src/` to understand implementation and upstream ownership, but do not assume that checkout matches the installed version.
- Confirm that every import is exported from the package root. The package does not expose arbitrary `dist/core/**` deep imports.
- Import types with `import type`; do not duplicate Pi interfaces in Workbench.

### 2. Choose the narrowest SDK layer

- Use an `ExtensionFactory` when behavior reacts to Pi lifecycle or must register tools, commands, providers, renderers, flags, or shortcuts.
- Wrap internal factories in a named `InlineExtension` when injecting them through `resourceLoaderOptions.extensionFactories`.
- Use `customTools` for a host-owned tool definition or same-name execution override that does not need extension lifecycle hooks.
- Use `createAgentSession()` for standalone/simple SDK integrations.
- Use `createAgentSessionServices()` followed by `createAgentSessionFromServices()` when Workbench must resolve cwd-bound settings, models, resources, or session options before constructing the session.
- Use the existing Workbench RPC/client manager instead of importing Pi into React or opening an independent Pi connection.

### 3. Reuse the current Workbench composition

- Put statically compiled, host-owned Pi extensions under `packages/agent-runtime/adapters/pi/server/src/internal-extensions/`.
- Keep user/package extension discovery and mutation in the existing extension/package services; do not disguise internal extensions as user files.
- Add internal extensions to the stable module-level `workbenchInternalPiExtensions` array with a `workbench.` name and `hidden: true` unless they should appear in Pi's startup extension list.
- Preserve `extensionsOverride` composition and return the complete `LoadExtensionsResult`. Report scoped failures without discarding unrelated extensions, errors, or the shared runtime.
- Bind embedded sessions with the correct mode and host-provided UI context after creation. Reuse the current `session.bindExtensions({ mode: "rpc", uiContext })` flow.

### 4. Implement lifecycle-safe behavior

- Keep extension factory initialization finite. Await one-time discovery/configuration when needed, but start processes, sockets, watchers, and timers only from a session event or the action that needs them.
- Pair long-lived resources with an idempotent `session_shutdown` cleanup path.
- Use the event-specific return contract; returning an arbitrary object from a handler has no effect and may be incorrect.
- Guard mode/UI assumptions with `ctx.mode`, `ctx.hasUI`, and the concrete bound `ExtensionUIContext` behavior.
- Treat tool arguments and external data as untrusted. Use the SDK schema and result shapes rather than casts.
- Handle rejected promises in host callbacks and expose actionable extension-load errors to the server log or existing diagnostics surface.

### 5. Preserve the boundary

- Keep `@earendil-works/pi-coding-agent` imports in server/runtime modules. Never serialize `AgentSession`, `ExtensionAPI`, `ExtensionRuntime`, registries, callbacks, Maps, or tool definitions to the browser.
- Promote only stable JSON-compatible request/response/event fields into `@workbench/agent-runtime-pi-protocol` or the Workbench-owned adapter contracts when a frontend needs them.
- Do not copy raw Pi RPC types into Workbench or call legacy `/api/pi/**` routes from a new feature. Follow the transport named by `runtime/pi/README.md`.
- Keep project-trust checks and filesystem/provider credentials on the server side.

## Validate proportionally

- For type/import-only changes, inspect the resolved declarations and run the cheapest relevant TypeScript or targeted test check.
- For extension behavior, add or update a focused test around the owning server module; simulate events and loader results without real provider calls.
- For session creation, binding, reload, or resource discovery changes, run targeted Pi runtime tests plus `pnpm exec tsc --noEmit` when types cross modules.
- Do not open a browser unless a concrete UI synchronization or interaction uncertainty remains.

## Guardrails

- Prefer public root imports from `@earendil-works/pi-coding-agent`; do not deep-import implementation files.
- Prefer Pi's existing loader, runtime, runner, service, and tool abstractions over parallel lifecycle machinery.
- Never mutate `LoadExtensionsResult.runtime` casually; it is shared across the loaded extension set and is bound to the active runner.
- Never start a second Pi service or event stream for a feature already covered by the embedded runtime.
- Never infer the API from the local Pi checkout alone when its version differs from the installed dependency.
- Preserve unrelated worktree changes, especially in `packages/agent-runtime/adapters/pi/server/src/sessions/` and `packages/agent-runtime/adapters/pi/server/src/extensions/`.
