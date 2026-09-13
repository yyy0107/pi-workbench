# @workbench/pi-sdk-sessions

[中文](README.zh-CN.md) · [Package navigation](../../README.md) · [Layer overview](../README.md)

Hosted Pi session lifecycle, execution, history and persistence services.

Execution environment: Node.js / server.

## Responsibilities

- Create the session registry and use Pi SDK services to start or restore hosted sessions.
- Own execution, queueing, journals, history, attachments, imports, usage and session-facing automation.
- Retain one process state graph, HMR adoption path, scratch expiry lifecycle and serialized mutation/fork queues.

## Imports

```ts
import { createPiSessionRegistry } from "@workbench/pi-sdk-sessions/registry";
import type { PiSessionRuntimeDependencies } from "@workbench/pi-sdk-sessions/session-runtime-dependencies";
```

These examples identify public imports. Supply the dependencies and options declared by the entry when constructing services or installing capabilities.

This package has no root entry; select an explicit subpath from the table below.

### Public entries and source

[package.json](package.json) `exports` is authoritative. This table lists all current public entries. Source links locate implementations; cross-package code imports the package entry on the left.

| Import path                                                  | Entry source                                                                         |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------ |
| `@workbench/pi-sdk-sessions/cold-session-event-cache`        | [src/cold-session-event-cache.ts](./src/cold-session-event-cache.ts)                 |
| `@workbench/pi-sdk-sessions/composer-conversation-context`   | [src/composer-conversation-context.ts](./src/composer-conversation-context.ts)       |
| `@workbench/pi-sdk-sessions/composer-workspace-file-context` | [src/composer-workspace-file-context.ts](./src/composer-workspace-file-context.ts)   |
| `@workbench/pi-sdk-sessions/inline-image-admission`          | [src/inline-image-admission.ts](./src/inline-image-admission.ts)                     |
| `@workbench/pi-sdk-sessions/interactive`                     | [src/interactive-response-registry.ts](./src/interactive-response-registry.ts)       |
| `@workbench/pi-sdk-sessions/scratch`                         | [src/pi-scratch-session-store.ts](./src/pi-scratch-session-store.ts)                 |
| `@workbench/pi-sdk-sessions/context-trace`                   | [src/pi-session-context-trace-service.ts](./src/pi-session-context-trace-service.ts) |
| `@workbench/pi-sdk-sessions/history`                         | [src/pi-session-history-service.ts](./src/pi-session-history-service.ts)             |
| `@workbench/pi-sdk-sessions/model-context`                   | [src/pi-session-model-context-service.ts](./src/pi-session-model-context-service.ts) |
| `@workbench/pi-sdk-sessions/protocol`                        | [src/pi-session-protocol-facade.ts](./src/pi-session-protocol-facade.ts)             |
| `@workbench/pi-sdk-sessions/session-catalog-index`           | [src/session-catalog-index.ts](./src/session-catalog-index.ts)                       |
| `@workbench/pi-sdk-sessions/session-context-breakdown`       | [src/session-context-breakdown.ts](./src/session-context-breakdown.ts)               |
| `@workbench/pi-sdk-sessions/session-context-policy`          | [src/session-context-policy.ts](./src/session-context-policy.ts)                     |
| `@workbench/pi-sdk-sessions/session-context-trace-journal`   | [src/session-context-trace-journal.ts](./src/session-context-trace-journal.ts)       |
| `@workbench/pi-sdk-sessions/session-context-trace-summary`   | [src/session-context-trace-summary.ts](./src/session-context-trace-summary.ts)       |
| `@workbench/pi-sdk-sessions/session-context-trace`           | [src/session-context-trace.ts](./src/session-context-trace.ts)                       |
| `@workbench/pi-sdk-sessions/session-event-journal`           | [src/session-event-journal.ts](./src/session-event-journal.ts)                       |
| `@workbench/pi-sdk-sessions/export`                          | [src/session-export.ts](./src/session-export.ts)                                     |
| `@workbench/pi-sdk-sessions/session-initial-model`           | [src/session-initial-model.ts](./src/session-initial-model.ts)                       |
| `@workbench/pi-sdk-sessions/session-interruption`            | [src/session-interruption.ts](./src/session-interruption.ts)                         |
| `@workbench/pi-sdk-sessions/session-queue`                   | [src/session-queue.ts](./src/session-queue.ts)                                       |
| `@workbench/pi-sdk-sessions/registry`                        | [src/session-registry.ts](./src/session-registry.ts)                                 |
| `@workbench/pi-sdk-sessions/session-resume`                  | [src/session-resume.ts](./src/session-resume.ts)                                     |
| `@workbench/pi-sdk-sessions/session-rpc-service`             | [src/session-rpc-service.ts](./src/session-rpc-service.ts)                           |
| `@workbench/pi-sdk-sessions/session-runtime-dependencies`    | [src/session-runtime-dependencies.ts](./src/session-runtime-dependencies.ts)         |
| `@workbench/pi-sdk-sessions/system-prompt-placeholders`      | [src/system-prompt-placeholders.ts](./src/system-prompt-placeholders.ts)             |
| `@workbench/pi-sdk-sessions/usage-statistics-aggregation`    | [src/usage-statistics-aggregation.ts](./src/usage-statistics-aggregation.ts)         |
| `@workbench/pi-sdk-sessions/usage-statistics-store`          | [src/usage-statistics-store.ts](./src/usage-statistics-store.ts)                     |
| `@workbench/pi-sdk-sessions/usage`                           | [src/usage-statistics.ts](./src/usage-statistics.ts)                                 |
| `@workbench/pi-sdk-sessions/composer-text-attachments`       | [src/composer-text-attachments.ts](./src/composer-text-attachments.ts)               |
| `@workbench/pi-sdk-sessions/claude-code-session-importer`    | [src/claude-code-session-importer.ts](./src/claude-code-session-importer.ts)         |
| `@workbench/pi-sdk-sessions/codex-session-importer`          | [src/codex-session-importer.ts](./src/codex-session-importer.ts)                     |
| `@workbench/pi-sdk-sessions/cursor-session-importer`         | [src/cursor-session-importer.ts](./src/cursor-session-importer.ts)                   |
| `@workbench/pi-sdk-sessions/imports`                         | [src/external-session-import-service.ts](./src/external-session-import-service.ts)   |
| `@workbench/pi-sdk-sessions/external-session-types`          | [src/external-session-types.ts](./src/external-session-types.ts)                     |
| `@workbench/pi-sdk-sessions/source-utils`                    | [src/source-utils.ts](./src/source-utils.ts)                                         |
| `@workbench/pi-sdk-sessions/automation`                      | [src/pi-automation-service.ts](./src/pi-automation-service.ts)                       |
| `@workbench/pi-sdk-sessions/execution`                       | [src/pi-agent-execution.ts](./src/pi-agent-execution.ts)                             |
| `@workbench/pi-sdk-sessions/threads`                         | [src/pi-agent-thread-store.ts](./src/pi-agent-thread-store.ts)                       |

## Source navigation

| Location                                                                 | Purpose                                       |
| ------------------------------------------------------------------------ | --------------------------------------------- |
| [src/session-registry.ts](src/session-registry.ts)                       | Registry facade and SDK session construction  |
| [src/hosted-pi-session.ts](src/hosted-pi-session.ts)                     | Active session, events and queue coordination |
| [src/session-registry-state.ts](src/session-registry-state.ts)           | Process state and HMR retention               |
| [src/persisted-session-directory.ts](src/persisted-session-directory.ts) | Persisted session catalog                     |
| [src/scratch-session-directory.ts](src/scratch-session-directory.ts)     | Scratch sessions and expiry                   |
| [src/session-projections.ts](src/session-projections.ts)                 | Shared history/resume projections             |
| [lib/session-queue.ts](lib/session-queue.ts)                             | Queue helpers                                 |

## Boundaries and integration

Create one registry per server module generation through the server composition. PiSessionRuntimeDependencies injects Host, publisher, workspace access, resource installation and extension creation/preparation.

Product defaults are selected outside this package. Registry callers reuse the existing owners instead of constructing duplicate SDK sessions, locks, caches or cleanup hooks.

Related owners:

- [@workbench/pi-runtime-server](../../pi-runtime/pi-runtime-server/README.md)
- [@workbench/pi-sdk-models](../pi-sdk-models/README.md)
- [@workbench/pi-workbench-runtime](../../product/pi-workbench-runtime/README.md)

## Maintenance and validation

```bash
pnpm --filter @workbench/pi-sdk-sessions typecheck
```

Keep implementation in `src/` and consumed internal helpers in `lib/`, preserving the current shallow TypeScript layout. Cross-package references use public exports and `workspace:*`. See the [validation record](../../../docs/package-layout-validation.md) for non-UI regression selection and build checks. Documentation-only edits require entry/path/format checks; UI/DOM/Hook tests and interactive smoke tests remain excluded for this refactor.
