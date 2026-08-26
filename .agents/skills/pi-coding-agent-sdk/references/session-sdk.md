# Pi session SDK in Workbench

## Contents

- [Choose a construction path](#choose-a-construction-path)
- [Use the split Workbench path](#use-the-split-workbench-path)
- [Bind extensions](#bind-extensions)
- [Choose between custom tools and extensions](#choose-between-custom-tools-and-extensions)
- [Cross the browser boundary](#cross-the-browser-boundary)
- [Reload safely](#reload-safely)

## Choose a construction path

Use the smallest composition that satisfies the host:

| Situation                                                  | API                                                                    |
| ---------------------------------------------------------- | ---------------------------------------------------------------------- |
| Standalone script or simple SDK consumer                   | `createAgentSession(options)`                                          |
| Host must resolve cwd-bound services/options first         | `createAgentSessionServices()` then `createAgentSessionFromServices()` |
| Host must recreate a full runtime when cwd/session changes | `createAgentSessionRuntime()`                                          |
| Custom resource discovery only                             | `DefaultResourceLoader` passed to `createAgentSession()`               |

Do not reconstruct `ExtensionRuntime` or `ExtensionRunner` manually for a normal Workbench feature. Session creation already composes loader results, runner state, tools, settings, model runtime, and session manager.

## Use the split Workbench path

Workbench uses split construction because services are cwd-bound and the existing `SessionManager` is authoritative:

```ts
const services = await createAgentSessionServices({
  cwd,
  resourceLoaderOptions: {
    extensionFactories: workbenchInternalPiExtensions,
    extensionsOverride: reportWorkbenchInternalPiExtensionErrors,
  },
  resourceLoaderReloadOptions: {
    resolveProjectTrust: async () => projectTrustService.isTrusted(cwd),
  },
});

const { session, extensionsResult, modelFallbackMessage } = await createAgentSessionFromServices({
  services,
  sessionManager,
  customTools,
});
```

Use the returned `services.settingsManager`, `services.modelRuntime`, `services.resourceLoader`, and `services.diagnostics` instead of creating parallel instances for the same cwd.

The returned `extensionsResult` is the loader result used by the session. Inspect its errors when the host needs diagnostics; do not replace it with a second discovery pass.

## Bind extensions

After the session exists, bind the mode-specific UI context through the session:

```ts
await session.bindExtensions({
  mode: "rpc",
  uiContext: interactiveResponses.createExtensionUIContext(session.sessionId),
});
```

This connects extension context actions and Workbench's response/approval plumbing to the active session. Do not call runner internals directly.

Use the mode that matches the real host (`rpc` for Workbench). A fake `tui` mode can enable invalid UI assumptions in an extension.

## Choose between custom tools and extensions

Use `customTools` when:

- the host supplies a fixed tool definition;
- no extension event subscription is required;
- a same-name custom tool intentionally overrides built-in execution;
- tool selection is resolved during session construction.

Use `extensionFactories` plus `pi.registerTool()` when:

- the tool is one capability of a broader extension;
- registration depends on extension initialization or events;
- the extension also owns commands, providers, state, or lifecycle cleanup;
- tool availability changes dynamically during a session.

Do not register the same tool through both mechanisms unless the override order is deliberate, documented, and covered by a focused test.

## Cross the browser boundary

Pi coding-agent SDK objects are Node/runtime objects. The browser should consume Workbench contracts:

```text
React / assistant-ui
  -> runtime/pi client manager
  -> Workbench HTTP RPC or paired WebSocket streams
  -> runtime/pi server service
  -> Pi AgentSession / ResourceLoader / extensions
```

When a UI feature needs new Pi data:

1. Find an existing unary method or stream event in `runtime/pi/README.md`.
2. Add a server adapter only when the current protocol lacks the capability.
3. Define stable JSON-compatible fields in the owning Workbench contract.
4. Keep Pi-specific classes, Maps, callbacks, error objects, credentials, and paths behind the server adapter.
5. Consume the typed Workbench client API from the frontend.

Do not import `@earendil-works/pi-coding-agent` into client components, Zustand stores, or assistant-ui renderers.

## Reload safely

`ResourceLoader.reload()` refreshes discovered resources. `AgentSession.reload()` coordinates a live session reload and swaps active extension state. Prefer the session-level operation for a running session.

Before changing reload behavior, inspect the installed declarations and the implementation corresponding to the project's Pi version. Pay attention to:

- project-trust resolution;
- invalidation of stale extension instances;
- rebinding of core and UI actions;
- refresh of registered tools and providers;
- preservation of active session/model/tool state;
- reporting of extension errors and resource diagnostics.

Never keep callbacks or runtime objects from a replaced extension instance after reload. Register cleanup with the extension lifecycle and resolve current state through the active session/services.
