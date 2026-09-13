# @workbench/pi-runtime-adapters

[中文](README.zh-CN.md) · [Package navigation](../../README.md) · [Layer overview](../README.md)

Shared Pi Runtime identity and deterministic data adaptation.

Execution environment: Shared deterministic data/contracts for client and server.

## Responsibilities

- Project commands, reduce streamed messages and interpret model capabilities and session presentation data.
- Share composer prompt adaptation and existing formatting/pagination rules across consumers.

## Imports

```ts
import { PI_AGENT_RUNTIME_DESCRIPTOR } from "@workbench/pi-runtime-adapters/descriptor";
```

These examples identify public imports. Supply the dependencies and options declared by the entry when constructing services or installing capabilities.

This package has no root entry; select an explicit subpath from the table below.

### Public entries and source

[package.json](package.json) `exports` is authoritative. This table lists all current public entries. Source links locate implementations; cross-package code imports the package entry on the left.

| Import path                                      | Entry source                                       |
| ------------------------------------------------ | -------------------------------------------------- |
| `@workbench/pi-runtime-adapters/descriptor`      | [src/descriptor.ts](./src/descriptor.ts)           |
| `@workbench/pi-runtime-adapters/commands`        | [src/commands.ts](./src/commands.ts)               |
| `@workbench/pi-runtime-adapters/messages`        | [src/messages.ts](./src/messages.ts)               |
| `@workbench/pi-runtime-adapters/models`          | [src/models.ts](./src/models.ts)                   |
| `@workbench/pi-runtime-adapters/sessions`        | [src/sessions.ts](./src/sessions.ts)               |
| `@workbench/pi-runtime-adapters/composer-prompt` | [src/composer-prompt.ts](./src/composer-prompt.ts) |

## Source navigation

| Location                                         | Purpose                     |
| ------------------------------------------------ | --------------------------- |
| [src/descriptor.ts](src/descriptor.ts)           | Stable runtime identity     |
| [src/models.ts](src/models.ts)                   | Model capability adaptation |
| [src/messages.ts](src/messages.ts)               | Message adaptation entry    |
| [src/composer-prompt.ts](src/composer-prompt.ts) | Composer prompt adaptation  |
| [lib/prompt-template.ts](lib/prompt-template.ts) | Prompt formatting helper    |

## Boundaries and integration

The package does not own connections, credentials or SDK session lifecycle. Product resource installation and default extension selection live in pi-workbench-runtime.

Related owners:

- [@workbench/pi-runtime-client](../pi-runtime-client/README.md)
- [@workbench/pi-sdk-models](../../pi-sdk/pi-sdk-models/README.md)
- [@workbench/pi-conversation-adapter](../pi-conversation-adapter/README.md)
- [@workbench/pi-workbench-runtime](../../product/pi-workbench-runtime/README.md)

## Maintenance and validation

```bash
pnpm --filter @workbench/pi-runtime-adapters typecheck
```

Keep implementation in `src/` and consumed internal helpers in `lib/`, preserving the current shallow TypeScript layout. Cross-package references use public exports and `workspace:*`. See the [validation record](../../../docs/package-layout-validation.md) for non-UI regression selection and build checks. Documentation-only edits require entry/path/format checks; UI/DOM/Hook tests and interactive smoke tests remain excluded for this refactor.
