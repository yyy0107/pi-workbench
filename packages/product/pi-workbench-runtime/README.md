# @workbench/pi-workbench-runtime

[中文](README.zh-CN.md) · [Packages](../../README.md) · [Product](../README.md)

Workbench Node product capabilities: custom Pi tools, product prompts and interaction rules, inline extensions, default resources and deployment policy.

## Responsibilities

- Custom bash, enhanced search, ask-user, settings, workspace review, Todo, composer context, tracing and message termination.
- Default extension selection, enablement and loaded-result handling, preserving trace installation last.
- Product Skills, Prompts and tool attribution, built-in resource deployment and retired-resource cleanup.

## Imports

```ts
import { createWorkbenchBashToolOverride } from "@workbench/pi-workbench-runtime/tools/bash";
import { createWorkbenchSettingsExtension } from "@workbench/pi-workbench-runtime/extensions/workbench-settings";
import { createWorkbenchInternalPiExtensions } from "@workbench/pi-workbench-runtime/extensions";
import { ensureWorkbenchBuiltinResources } from "@workbench/pi-workbench-runtime/resources";
import type { WorkbenchToolDependencies } from "@workbench/pi-workbench-runtime/tools/dependencies";
```

This package has no root entry. `/tools` only prepares loaded extension results and reports errors. Import bash and other tools through explicit subpaths; `/tools` and `/tools/builtin-tools` do not aggregate bash. Supply the collaborators declared by each factory.

## Public entries

| Import                                                                              | Source                                                                                                     |
| ----------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `@workbench/pi-workbench-runtime/resources`                                         | [src/builtin-resources.ts](./src/builtin-resources.ts)                                                     |
| `@workbench/pi-workbench-runtime/resource-locations`                                | [src/resource-locations.ts](./src/resource-locations.ts)                                                   |
| `@workbench/pi-workbench-runtime/extensions`                                        | [src/extensions.ts](./src/extensions.ts)                                                                   |
| `@workbench/pi-workbench-runtime/builtin-packages`                                  | [src/builtin-packages.ts](./src/builtin-packages.ts), retired Browser resource cleanup                     |
| `@workbench/pi-workbench-runtime/tools/tool-availability`                           | [src/tool-runtime/tool-availability.ts](./src/tool-runtime/tool-availability.ts)                           |
| `@workbench/pi-workbench-runtime/tools/ask-user`                                    | [resources/extensions/ask-user/index.ts](./resources/extensions/ask-user/index.ts)                         |
| `@workbench/pi-workbench-runtime/tools/builtin-tools`                               | [resources/extensions/builtin-tools/index.ts](./resources/extensions/builtin-tools/index.ts)               |
| `@workbench/pi-workbench-runtime/tools/composer-context`                            | [resources/extensions/composer-context/index.ts](./resources/extensions/composer-context/index.ts)         |
| `@workbench/pi-workbench-runtime/tools/context-trace`                               | [resources/extensions/context-trace/index.ts](./resources/extensions/context-trace/index.ts)               |
| `@workbench/pi-workbench-runtime/tools/system-prompt-hook-trace`                    | [src/system-prompt-hook-trace/index.ts](./src/system-prompt-hook-trace/index.ts)                           |
| `@workbench/pi-workbench-runtime/tools/dependencies`                                | [src/tool-runtime/dependencies.ts](./src/tool-runtime/dependencies.ts)                                     |
| `@workbench/pi-workbench-runtime/tools/enhanced-search`                             | [src/tool-runtime/enhanced-search.ts](./src/tool-runtime/enhanced-search.ts)                               |
| `@workbench/pi-workbench-runtime/tools`                                             | [src/tool-runtime/index.ts](./src/tool-runtime/index.ts)                                                   |
| `@workbench/pi-workbench-runtime/tools/message-termination`                         | [resources/extensions/message-termination/index.ts](./resources/extensions/message-termination/index.ts)   |
| `@workbench/pi-workbench-runtime/tools/legacy-message-termination-extension-source` | [src/message-termination/legacy-extension-source.ts](./src/message-termination/legacy-extension-source.ts) |
| `@workbench/pi-workbench-runtime/tools/legacy-message-termination`                  | [src/message-termination/legacy.ts](./src/message-termination/legacy.ts)                                   |
| `@workbench/pi-workbench-runtime/tools/rpiv-todo`                                   | [resources/extensions/rpiv-todo/index.ts](./resources/extensions/rpiv-todo/index.ts)                       |
| `@workbench/pi-workbench-runtime/todo/invariants`                                   | [src/rpiv-todo/invariants.ts](./src/rpiv-todo/invariants.ts)                                               |
| `@workbench/pi-workbench-runtime/todo/replay`                                       | [src/rpiv-todo/replay.ts](./src/rpiv-todo/replay.ts)                                                       |
| `@workbench/pi-workbench-runtime/todo/state-reducer`                                | [src/rpiv-todo/state-reducer.ts](./src/rpiv-todo/state-reducer.ts)                                         |
| `@workbench/pi-workbench-runtime/todo/state`                                        | [src/rpiv-todo/state.ts](./src/rpiv-todo/state.ts)                                                         |
| `@workbench/pi-workbench-runtime/todo/task-graph`                                   | [src/rpiv-todo/task-graph.ts](./src/rpiv-todo/task-graph.ts)                                               |
| `@workbench/pi-workbench-runtime/todo/response-envelope`                            | [src/rpiv-todo/response-envelope.ts](./src/rpiv-todo/response-envelope.ts)                                 |
| `@workbench/pi-workbench-runtime/todo/sanitize`                                     | [src/rpiv-todo/sanitize.ts](./src/rpiv-todo/sanitize.ts)                                                   |
| `@workbench/pi-workbench-runtime/todo/types`                                        | [src/rpiv-todo/types.ts](./src/rpiv-todo/types.ts)                                                         |
| `@workbench/pi-workbench-runtime/tools/workbench-settings`                          | [resources/extensions/workbench-settings/index.ts](./resources/extensions/workbench-settings/index.ts)     |
| `@workbench/pi-workbench-runtime/tools/workspace-review`                            | [resources/extensions/workspace-review/index.ts](./resources/extensions/workspace-review/index.ts)         |
| `@workbench/pi-workbench-runtime/tool-resources`                                    | [src/tool-resources.ts](./src/tool-resources.ts)                                                           |
| `@workbench/pi-workbench-runtime/tools/bash`                                        | [src/bash/index.ts](./src/bash/index.ts)                                                                   |
| `@workbench/pi-workbench-runtime/extensions/ask-user`                               | [resources/extensions/ask-user/index.ts](./resources/extensions/ask-user/index.ts)                         |
| `@workbench/pi-workbench-runtime/extensions/rpiv-todo`                              | [resources/extensions/rpiv-todo/index.ts](./resources/extensions/rpiv-todo/index.ts)                       |
| `@workbench/pi-workbench-runtime/extensions/workbench-settings`                     | [resources/extensions/workbench-settings/index.ts](./resources/extensions/workbench-settings/index.ts)     |
| `@workbench/pi-workbench-runtime/extensions/workspace-review`                       | [resources/extensions/workspace-review/index.ts](./resources/extensions/workspace-review/index.ts)         |
| `@workbench/pi-workbench-runtime/extensions/composer-context`                       | [resources/extensions/composer-context/index.ts](./resources/extensions/composer-context/index.ts)         |
| `@workbench/pi-workbench-runtime/extensions/message-termination`                    | [resources/extensions/message-termination/index.ts](./resources/extensions/message-termination/index.ts)   |
| `@workbench/pi-workbench-runtime/extensions/context-trace`                          | [resources/extensions/context-trace/index.ts](./resources/extensions/context-trace/index.ts)               |
| `@workbench/pi-workbench-runtime/extensions/builtin-tools`                          | [resources/extensions/builtin-tools/index.ts](./resources/extensions/builtin-tools/index.ts)               |

## Source navigation

Each custom tool owns a directory under `src/`: `bash`, `ask-user`, `grep`, `find`, `rpiv-todo`, `workbench-settings`, and `workspace-review`. Tool-specific helpers and attribution live alongside the implementation. `tool-runtime` contains shared assembly; context/trace/termination hooks have their own capability directories. `resources/` contains only Pi resource kinds (`extensions`, `skills`, and `prompts`); the Todo README and MIT license belong to `src/rpiv-todo/`. Tests remain in package-root `tests/`.

| Location                                             | Contents                                            |
| ---------------------------------------------------- | --------------------------------------------------- |
| [src](src)                                           | Product tool execution and shared projections       |
| [src/rpiv-todo](src/rpiv-todo)                       | Todo state machine, replay and validation           |
| [src/extensions.ts](src/extensions.ts)               | Default extension selection and order               |
| [src/tool-resources.ts](src/tool-resources.ts)       | Tool snapshot allowlist and locations               |
| [src/builtin-resources.ts](src/builtin-resources.ts) | Built-in resource deployment and compatible cleanup |
| [resources/extensions](resources/extensions)         | Pi extension registration and lifecycle entries     |
| [resources/skills](resources/skills)                 | Product Skills                                      |
| [resources/prompts](resources/prompts)               | Product Prompts                                     |
| [src/rpiv-todo/LICENSE](src/rpiv-todo/LICENSE)       | Tool attribution and MIT license                    |
| [lib](lib)                                           | Helpers consumed by tools and deployment            |

## Boundaries and composition

Extension registration lives in `resources/extensions/<name>/index.ts`; tool schemas, execution, state, and output stay in `src/<tool-name>/`. Import extension factories through `/extensions/<name>`. The retained combined `/tools/<name>` entries resolve to the same resource modules; the package currently exposes 37 explicit entries. `src/extensions.ts` statically imports the resources and injects host dependencies, preserving ordering and enablement. These host-owned resources are not additionally enabled through filesystem discovery. See [extension resource guide](resources/extensions/README.md).

The product owns concrete tool implementations and product rules. Generic PTY, terminal sessions and native dependencies stay in terminal-server; Git/workspace capabilities stay in workspace-server; SDK sessions, models and resource loading stay in pi-sdk.

Runtime composition injects Host, trace, settings and the shared terminal session manager. SDK sessions receive tool-override selection and review parsing through PiSessionRuntimeDependencies callbacks, without importing this product. The product imports neither React, frontend product composition nor pi-runtime-server.

The model-callable Browser tool, Pi extension, compatibility package and browser-use Skill are retired. `/resources` removes their reserved built-in package and earlier standalone filters during deployment so upgraded profiles do not keep loading them. The right-workspace Browser tab remains a separate workspace-browser/browser-server capability. `/tool-resources` describes only retained tool source snapshots, and builders use the same allowlist so Skills/Prompts and product deployment code are not duplicated under internal-extensions.

Tool names, source identifiers such as workbench.terminal, extension IDs, schemas, prompts, output budgets, cancellation, enablement and persistence formats remain stable for retained capabilities. Artifact roots internal-skills/internal-prompts/internal-extensions and their .builtin locations remain intact. Tool snapshots use per-tool `src/<tool-name>/` directories; cleanup removes only known retired product files and preserves unknown additions outside the reserved Browser package directory.

## Related capabilities

- [terminal-server](../../terminal/terminal-server/README.md)
- [workspace-server](../../server/workspace-server/README.md)
- [pi-sdk-sessions](../../pi-sdk/pi-sdk-sessions/README.md)
- [pi-sdk-resources](../../pi-sdk/pi-sdk-resources/README.md)
- [browser-server](../../server/browser-server/README.md)
- [pi-runtime-server](../../pi-runtime/pi-runtime-server/README.md)

## Validation

```bash
pnpm --filter @workbench/pi-workbench-runtime typecheck
pnpm --filter @workbench/pi-workbench-runtime test
```

[Spec011 plan and validation](../../../specs/011-product-tool-ownership/plan.md). This migration uses non-UI logic, type, structure, dependency and build checks; UI rendering and interaction tests are excluded.

## Browser boundary

The right-workspace Browser tab is owned by [workspace-browser](../../workspace/workspace-browser/README.md), with its generic protocol and engine in browser-contracts and browser-server. This Node product no longer exports or deploys a model-callable Browser extension, tool, package or Skill; `src/builtin-packages.ts` only removes the retired reserved installation from existing profiles.
