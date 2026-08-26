# Pi extension SDK

## Contents

- [Choose the extension form](#choose-the-extension-form)
- [Register an internal Workbench extension](#register-an-internal-workbench-extension)
- [Choose an event](#choose-an-event)
- [Use ExtensionAPI capabilities](#use-extensionapi-capabilities)
- [Load and inspect extensions](#load-and-inspect-extensions)
- [Handle lifecycle and errors](#handle-lifecycle-and-errors)

## Choose the extension form

`ExtensionFactory` is the executable unit:

```ts
import type { ExtensionFactory } from "@earendil-works/pi-coding-agent";

export const exampleExtension: ExtensionFactory = (pi) => {
  pi.on("agent_start", () => {
    // React to one agent run.
  });
};
```

The factory may return `void` or `Promise<void>`. Pi awaits async initialization before startup events and before queued provider registrations are flushed.

`InlineExtension` is either a bare factory or a named wrapper:

```ts
type InlineExtension =
  | ExtensionFactory
  | {
      name: string;
      factory: ExtensionFactory;
      hidden?: boolean;
    };
```

Prefer the named wrapper for Workbench-owned extensions so load errors and diagnostics have a stable `<inline:name>` path.

## Register an internal Workbench extension

Follow the repository's stable catalog pattern:

```ts
import type { InlineExtension } from "@earendil-works/pi-coding-agent";

import { exampleExtension } from "./example";

export const workbenchInternalPiExtensions = [
  {
    name: "workbench.example",
    factory: exampleExtension,
    hidden: true,
  },
] satisfies InlineExtension[];
```

Keep this array at module scope. Add it to `createAgentSessionServices({ resourceLoaderOptions: { extensionFactories } })`; do not manually invoke the factory.

Use `hidden: true` only for host plumbing that should not appear in Pi's startup extension list. Do not hide a user-facing extension merely to suppress an error; handle the error instead.

## Choose an event

Use the narrowest event that owns the behavior:

| Need                                                    | Event/API                               |
| ------------------------------------------------------- | --------------------------------------- |
| Initialize session-scoped state                         | `session_start`                         |
| Release session-scoped resources                        | `session_shutdown`                      |
| Modify system prompt before a run                       | `before_agent_start` return value       |
| Observe one complete run                                | `agent_end`                             |
| Wait until retry/compaction/follow-up work is exhausted | `agent_settled`                         |
| Inspect or replace finalized messages                   | `message_end` return value              |
| Modify LLM context messages                             | `context` return value                  |
| Inspect/replace provider payload                        | `before_provider_request`               |
| Mutate provider headers                                 | `before_provider_headers`               |
| Observe provider status/headers                         | `after_provider_response`               |
| Guard tool execution                                    | `tool_call` return value                |
| Modify tool output                                      | `tool_result` return value              |
| Observe tool execution progress                         | `tool_execution_start/update/end`       |
| Intercept or transform input                            | `input` return value                    |
| Add discovered resource paths                           | `resources_discover` return value       |
| Guard session replacement                               | `session_before_switch/fork/tree`       |
| Observe model/reasoning changes                         | `model_select`, `thinking_level_select` |

Read the exact overload and event/result declarations in the installed `dist/core/extensions/types.d.ts` before implementing. Event payloads and legal return shapes can change between Pi versions.

Important sequencing for a normal prompt:

```text
input
  -> before_agent_start
  -> agent_start
  -> message_start/update/end
  -> turn_start
  -> context
  -> provider hooks
  -> tool execution hooks when applicable
  -> turn_end
  -> agent_end
  -> agent_settled
```

Tool turns and message events can repeat. Do not infer “the run is fully idle” from `message_end` or `agent_end` when `agent_settled` expresses that requirement.

## Use ExtensionAPI capabilities

The factory receives one `ExtensionAPI` (`pi`). Its main capability groups are:

| Capability             | Methods                                                                                         |
| ---------------------- | ----------------------------------------------------------------------------------------------- |
| Events                 | `on`, `events`                                                                                  |
| Model-callable tools   | `registerTool`, `getAllTools`, `getActiveTools`, `setActiveTools`                               |
| Commands/input         | `registerCommand`, `getCommands`, `registerShortcut`, `registerFlag`, `getFlag`                 |
| Session messages/state | `sendMessage`, `sendUserMessage`, `appendEntry`, `setSessionName`, `getSessionName`, `setLabel` |
| Model/provider control | `setModel`, `getThinkingLevel`, `setThinkingLevel`, `registerProvider`, `unregisterProvider`    |
| Rendering for Pi TUI   | `registerMessageRenderer`, `registerEntryRenderer`, `registerMarkdownTransformer`               |
| Host execution         | `exec`                                                                                          |

Check `ctx.mode` and `ctx.hasUI` before using `ctx.ui`. Workbench binds RPC-mode UI interactions through its `ExtensionUIContext`; TUI renderer registration does not automatically create a Workbench React renderer.

Use `pi.registerTool()` when the tool belongs to extension lifecycle or is dynamically registered. Use the SDK's `defineTool()` plus session `customTools` when the host owns a standalone definition or needs an execution override.

Do not register a Workbench frontend Renderer by calling Pi's TUI renderer APIs. Workbench message/tool rendering belongs to the assistant-ui extension platform.

## Load and inspect extensions

Normal embedding should use `DefaultResourceLoader` indirectly through `createAgentSessionServices()` or explicitly for a standalone session. It combines discovered file extensions and `extensionFactories` into a `LoadExtensionsResult`:

```ts
interface LoadExtensionsResult {
  extensions: Extension[];
  errors: Array<{ path: string; error: string }>;
  runtime: ExtensionRuntime;
}
```

`runtime` is shared by the loaded set. Loader-created action stubs are bound to the active core by the extension runner. Preserve it when filtering or annotating the result.

An `extensionsOverride` must return the whole result:

```ts
import type { LoadExtensionsResult } from "@earendil-works/pi-coding-agent";

export function reportInternalErrors(result: LoadExtensionsResult): LoadExtensionsResult {
  for (const error of result.errors) {
    if (!error.path.startsWith("<inline:workbench.")) continue;
    console.error("[workbench-pi] internal extension failed", error.path, error.error);
  }
  return result;
}
```

Use the root-exported `discoverAndLoadExtensions()` only when building standalone discovery infrastructure. In the installed package, `loadExtensions()` and `loadExtensionFromFactory()` exist below `core/extensions` but are not root exports; do not reach them through a `dist/**` deep import. Feature code should not create its own runtime or runner beside the session's `ResourceLoader`.

## Handle lifecycle and errors

- Do not start long-lived work from a factory; some factory invocations never start a session.
- Start session-owned resources lazily and clean them in an idempotent `session_shutdown` handler.
- Remember that extension handlers can be async and can fail. Decide whether the owning host should log, surface, recover, or reject startup.
- Namespace custom message types, event-bus topics, command names, and provider ids to avoid collisions.
- Preserve unrelated extensions and errors when applying host overrides.
- Treat provider credentials, tool execution, filesystem paths, and project-trust decisions as server concerns.
