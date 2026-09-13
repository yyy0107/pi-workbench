# @workbench/pi-runtime-client

[中文](README.zh-CN.md) · [Package navigation](../../README.md) · [Layer overview](../README.md)

Browser-side Pi implementation of Workbench AgentRuntime and capability APIs.

Execution environment: Browser / React.

## Responsibilities

- Install one Pi runtime and expose finite Host, workspace, model, session and interaction capabilities.
- Coordinate the session directory, canonical history, attachment preparation, queues and live conversation state.
- Adapt Pi-specific errors and expose configuration, resources, Trace, usage and import APIs through explicit entries.

## Imports

```ts
import { createPiAgentRuntimeInstallation } from "@workbench/pi-runtime-client/installation";
import type { PiAgentRuntimeInstallationOptions } from "@workbench/pi-runtime-client/installation";
```

These examples identify public imports. Supply the dependencies and options declared by the entry when constructing services or installing capabilities.

This package has no root entry; select an explicit subpath from the table below.

### Public entries and source

[package.json](package.json) `exports` is authoritative. This table lists all current public entries. Source links locate implementations; cross-package code imports the package entry on the left.

| Import path                                     | Entry source                                                       |
| ----------------------------------------------- | ------------------------------------------------------------------ |
| `@workbench/pi-runtime-client/usage-statistics` | [src/public/usage-statistics.ts](./src/public/usage-statistics.ts) |
| `@workbench/pi-runtime-client/installation`     | [src/public/installation.tsx](./src/public/installation.tsx)       |
| `@workbench/pi-runtime-client/errors`           | [src/public/errors.ts](./src/public/errors.ts)                     |
| `@workbench/pi-runtime-client/host`             | [src/public/host.ts](./src/public/host.ts)                         |
| `@workbench/pi-runtime-client/resources`        | [src/public/resources.ts](./src/public/resources.ts)               |
| `@workbench/pi-runtime-client/configuration`    | [src/public/configuration.ts](./src/public/configuration.ts)       |
| `@workbench/pi-runtime-client/workspace`        | [src/public/workspace.ts](./src/public/workspace.ts)               |
| `@workbench/pi-runtime-client/external-import`  | [src/public/external-import.ts](./src/public/external-import.ts)   |
| `@workbench/pi-runtime-client/context-trace`    | [src/public/context-trace.ts](./src/public/context-trace.ts)       |

## Source navigation

| Location                                                                                   | Purpose                             |
| ------------------------------------------------------------------------------------------ | ----------------------------------- |
| [src/public/installation.tsx](src/public/installation.tsx)                                 | Public installation entry           |
| [src/integration/pi-runtime-installation.tsx](src/integration/pi-runtime-installation.tsx) | Installation and dependency binding |
| [src/runtime/manager.ts](src/runtime/manager.ts)                                           | Runtime orchestration               |
| [src/runtime/manager-catalog.ts](src/runtime/manager-catalog.ts)                           | Directory state owner               |
| [src/runtime/session.ts](src/runtime/session.ts)                                           | Single-session orchestration        |
| [src/runtime/session-history.ts](src/runtime/session-history.ts)                           | Canonical history owner             |
| [src/runtime/session-attachments.ts](src/runtime/session-attachments.ts)                   | Attachment lifecycle owner          |
| [lib/fork-title.ts](lib/fork-title.ts)                                                     | Fork title helper                   |

## Boundaries and integration

The manager binds a finite PiClientSessionDependencies contract; sessions do not receive the whole manager. Catalog, history and attachments have focused owners within the same authoritative state graph.

Transport lives in pi-rpc-client and message projection in pi-conversation-adapter. There are no local transport/ or conversation/ ownership directories to import.

Workbench settings clients come from services-client/settings and are wired by pi-workbench. This package does not expose a workbench-settings entry.

Stable Node/Block references and the existing microtask/animation-frame/terminal publication timing are retained. Generic UI consumes Workbench capabilities instead of Pi protocol objects.

Related owners:

- [@workbench/pi-rpc-client](../pi-rpc-client/README.md)
- [@workbench/pi-conversation-adapter](../pi-conversation-adapter/README.md)
- [@workbench/pi-workbench](../../product/pi-workbench/README.md)
- [@workbench/agent-runtime-client](../../agent-runtime/agent-runtime-client/README.md)
- [@workbench/services-client](../../client/services-client/README.md)

```text
Pi transport / history → PiClientSession + focused state owners
                      → PiConversationAssembler
                      → Workbench ConversationSnapshot + Node/Block observables
```

## Maintenance and validation

```bash
pnpm --filter @workbench/pi-runtime-client typecheck
```

Keep implementation in `src/` and consumed internal helpers in `lib/`, preserving the current shallow TypeScript layout. Cross-package references use public exports and `workspace:*`. See the [validation record](../../../docs/package-layout-validation.md) for non-UI regression selection and build checks. Documentation-only edits require entry/path/format checks; UI/DOM/Hook tests and interactive smoke tests remain excluded for this refactor.
