# Pi extension SDK

## Contents

- [Choose the extension form](#choose-the-extension-form)
- [Register an internal Workbench extension](#register-an-internal-workbench-extension)
- [Choose an event](#choose-an-event)
- [Use ExtensionAPI capabilities](#use-extensionapi-capabilities)
- [Bound tool output](#bound-tool-output)
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

## Bound tool output

Tool authors own this boundary: `registerTool()` does not automatically truncate arbitrary custom results. Compaction's summary-input limits do not bound normal tool turns. Read the installed SDK's `docs/extensions.md` section **Output Truncation** and `examples/extensions/truncated-tool.ts` before implementing file spill behavior.

1. Select relevant fields or paginate at the source. Describe/list defaults should be an overview; updates should return changed fields and the committed revision/status. Reuse an existing builtin tool's output handling when it already covers the operation.
2. Import `truncateHead`, `truncateTail`, `DEFAULT_MAX_BYTES`, and `DEFAULT_MAX_LINES` as needed from the public package root. Pi defaults are 50 KiB of UTF-8 and 2,000 lines, whichever is reached first. Budget the combined text blocks and any added notice, not just each field or JavaScript string length. Bound progress, errors, and persisted `details` too.
3. Keep head/tail previews for plain text. For JSON, return a valid bounded summary with a truncation flag, essential metadata, and a source/file reference; never splice raw JSON into an invalid prefix. Do not stash the full omitted value in `details` or log it.
4. Prefer an existing readable source with offset/limit or a cursor. Otherwise follow the SDK's temporary-file example using Node's filesystem APIs; retain the complete, already filtered/redacted result. Use a private directory and `0600` files for potentially sensitive settings. Return an absolute path and retrieval instructions; long JSON strings need field extraction or string slices because `read` is line based. Keep successful files available after the call; clean incomplete files on error/cancellation.
5. Preserve mutation semantics: if persistence succeeded but output spill failed, report the committed revision/status and a bounded output error. Do not imply that repeating the update is necessary. Respect the operation's AbortSignal where cancellation is still possible.

The Workbench settings implementation at `packages/agent-runtime/runtimes/pi/server/src/internal-extensions/workbench-settings/index.ts` demonstrates field selection and JSON offload for both describe and update. It reuses Pi's public budget checks without modifying the SDK or installing a parallel result middleware.

Test the owning tool with ordinary data, byte-heavy Unicode, many short lines, and a single oversized line as relevant. Assert bounded model content/details, complete file contents, permissions, and a useful failure/cancellation result. A registration-only load check does not exercise these paths.

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
