# @workbench/pi-runtime-tools

[中文](README.zh-CN.md) · [Package navigation](../../README.md) · [Layer overview](../README.md)

Workbench-specific Pi tool factories and extension execution adapters.

Execution environment: Node.js / server.

## Responsibilities

- Implement settings, workspace review, Todo, ask-user, composer context, tracing and message termination behavior.
- Provide built-in tool definitions/overrides, enablement handling and bounded structured tool results.
- Prepare loaded extension results while preserving user extensions and the shared SDK runtime.

## Imports

```ts
import { prepareWorkbenchPiExtensions } from "@workbench/pi-runtime-tools";
import { createWorkbenchSettingsExtension } from "@workbench/pi-runtime-tools/workbench-settings";
import type { WorkbenchToolDependencies } from "@workbench/pi-runtime-tools/dependencies";
```

These examples identify public imports. Supply the dependencies and options declared by the entry when constructing services or installing capabilities.

### Public entries and source

[package.json](package.json) `exports` is authoritative. This table lists all current public entries. Source links locate implementations; cross-package code imports the package entry on the left.

| Import path                                                               | Entry source                                                                                               |
| ------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `@workbench/pi-runtime-tools/tool-availability`                           | [src/tool-availability.ts](./src/tool-availability.ts)                                                     |
| `@workbench/pi-runtime-tools/ask-user`                                    | [src/ask-user.ts](./src/ask-user.ts)                                                                       |
| `@workbench/pi-runtime-tools/builtin-tools`                               | [src/builtin-tools.ts](./src/builtin-tools.ts)                                                             |
| `@workbench/pi-runtime-tools/composer-context`                            | [src/composer-context.ts](./src/composer-context.ts)                                                       |
| `@workbench/pi-runtime-tools/context-trace`                               | [src/context-trace.ts](./src/context-trace.ts)                                                             |
| `@workbench/pi-runtime-tools/system-prompt-hook-trace`                    | [src/system-prompt-hook-trace.ts](./src/system-prompt-hook-trace.ts)                                       |
| `@workbench/pi-runtime-tools/dependencies`                                | [src/dependencies.ts](./src/dependencies.ts)                                                               |
| `@workbench/pi-runtime-tools/enhanced-search`                             | [src/enhanced-search.ts](./src/enhanced-search.ts)                                                         |
| `@workbench/pi-runtime-tools`                                             | [src/index.ts](./src/index.ts)                                                                             |
| `@workbench/pi-runtime-tools/message-termination`                         | [src/message-termination.ts](./src/message-termination.ts)                                                 |
| `@workbench/pi-runtime-tools/legacy-message-termination-extension-source` | [src/legacy-message-termination-extension-source.ts](./src/legacy-message-termination-extension-source.ts) |
| `@workbench/pi-runtime-tools/legacy-message-termination`                  | [src/legacy-message-termination.ts](./src/legacy-message-termination.ts)                                   |
| `@workbench/pi-runtime-tools/rpiv-todo`                                   | [src/rpiv-todo.ts](./src/rpiv-todo.ts)                                                                     |
| `@workbench/pi-runtime-tools/invariants`                                  | [src/todo/invariants.ts](./src/todo/invariants.ts)                                                         |
| `@workbench/pi-runtime-tools/replay`                                      | [src/todo/replay.ts](./src/todo/replay.ts)                                                                 |
| `@workbench/pi-runtime-tools/state-reducer`                               | [src/todo/state-reducer.ts](./src/todo/state-reducer.ts)                                                   |
| `@workbench/pi-runtime-tools/state`                                       | [src/todo/state.ts](./src/todo/state.ts)                                                                   |
| `@workbench/pi-runtime-tools/task-graph`                                  | [src/todo/task-graph.ts](./src/todo/task-graph.ts)                                                         |
| `@workbench/pi-runtime-tools/response-envelope`                           | [src/response-envelope.ts](./src/response-envelope.ts)                                                     |
| `@workbench/pi-runtime-tools/sanitize`                                    | [src/sanitize.ts](./src/sanitize.ts)                                                                       |
| `@workbench/pi-runtime-tools/types`                                       | [src/todo/types.ts](./src/todo/types.ts)                                                                   |
| `@workbench/pi-runtime-tools/workbench-settings`                          | [src/workbench-settings.ts](./src/workbench-settings.ts)                                                   |
| `@workbench/pi-runtime-tools/workspace-review`                            | [src/workspace-review.ts](./src/workspace-review.ts)                                                       |
| `@workbench/pi-runtime-tools/resources`                                   | [src/resources.ts](./src/resources.ts)                                                                     |

## Source navigation

| Location                                                           | Purpose                                       |
| ------------------------------------------------------------------ | --------------------------------------------- |
| [src/index.ts](src/index.ts)                                       | Result preparation and scoped error reporting |
| [src/dependencies.ts](src/dependencies.ts)                         | Injected Workbench collaborators              |
| [src/builtin-tools.ts](src/builtin-tools.ts)                       | SDK definitions and Workbench overrides       |
| [src/workbench-settings.ts](src/workbench-settings.ts)             | Settings tool implementation                  |
| [src/rpiv-todo.ts](src/rpiv-todo.ts)                               | Todo extension factory                        |
| [lib/system-prompt-hook-trace.ts](lib/system-prompt-hook-trace.ts) | Hook tracing helper                           |

## Boundaries and integration

The default extension list is selected by pi-workbench-runtime/extensions. The root here exports preparation/error handling, not createWorkbenchInternalPiExtensions.

Factories receive WorkbenchToolDependencies instead of importing Host globals, the session registry or StreamHub. Preserve tool IDs, budgets, enablement and disposal.

resources/ contains tool attribution and source snapshots; product Skills and Prompts belong to pi-workbench-runtime.

Related owners:

- [@workbench/pi-workbench-runtime](../../product/pi-workbench-runtime/README.md)
- [@workbench/pi-runtime-server](../pi-runtime-server/README.md)
- [@workbench/pi-sdk-ports](../../pi-sdk/pi-sdk-ports/README.md)
- [@workbench/pi-runtime-terminal](../pi-runtime-terminal/README.md)

## Maintenance and validation

```bash
pnpm --filter @workbench/pi-runtime-tools typecheck
```

Keep implementation in `src/` and consumed internal helpers in `lib/`, preserving the current shallow TypeScript layout. Cross-package references use public exports and `workspace:*`. See the [validation record](../../../docs/package-layout-validation.md) for non-UI regression selection and build checks. Documentation-only edits require entry/path/format checks; UI/DOM/Hook tests and interactive smoke tests remain excluded for this refactor.
