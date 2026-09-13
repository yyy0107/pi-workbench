# @workbench/pi-sdk-ports

[中文](README.zh-CN.md) · [Package navigation](../../README.md) · [Layer overview](../README.md)

Narrow host and collaboration contracts consumed by Pi SDK services and tools.

Execution environment: In-process SDK/Host contracts; root entry is type-only.

## Responsibilities

- Define Host bindings, session access, stream publication, extension UI and tool settings contracts.
- Share domain errors, Trace capture contracts and preference-reading helpers.

## Imports

```ts
import type { PiAgentHostBindings } from "@workbench/pi-sdk-ports/host";
import type { PiStreamPublisher } from "@workbench/pi-sdk-ports/streams";
```

These examples identify public imports. Supply the dependencies and options declared by the entry when constructing services or installing capabilities.

The root exports types only; use the relevant subpath for runtime helpers.

### Public entries and source

[package.json](package.json) `exports` is authoritative. This table lists all current public entries. Source links locate implementations; cross-package code imports the package entry on the left.

| Import path                             | Entry source                                               |
| --------------------------------------- | ---------------------------------------------------------- |
| `@workbench/pi-sdk-ports`               | [src/index.ts](./src/index.ts)                             |
| `@workbench/pi-sdk-ports/host`          | [src/host-bindings.ts](./src/host-bindings.ts)             |
| `@workbench/pi-sdk-ports/tools`         | [src/tool-settings.ts](./src/tool-settings.ts)             |
| `@workbench/pi-sdk-ports/extension-ui`  | [src/extension-ui.ts](./src/extension-ui.ts)               |
| `@workbench/pi-sdk-ports/sessions`      | [src/session-access.ts](./src/session-access.ts)           |
| `@workbench/pi-sdk-ports/streams`       | [src/stream-publisher.ts](./src/stream-publisher.ts)       |
| `@workbench/pi-sdk-ports/preferences`   | [src/resource-preference.ts](./src/resource-preference.ts) |
| `@workbench/pi-sdk-ports/models`        | [src/model-observation.ts](./src/model-observation.ts)     |
| `@workbench/pi-sdk-ports/errors`        | [src/errors.ts](./src/errors.ts)                           |
| `@workbench/pi-sdk-ports/trace-capture` | [src/trace-capture.ts](./src/trace-capture.ts)             |
| `@workbench/pi-sdk-ports/tool-trace`    | [src/tool-context-trace.ts](./src/tool-context-trace.ts)   |

## Source navigation

| Location                                                         | Purpose                        |
| ---------------------------------------------------------------- | ------------------------------ |
| [src/index.ts](src/index.ts)                                     | Type-only contract aggregation |
| [src/host-bindings.ts](src/host-bindings.ts)                     | Host injection contract        |
| [src/stream-publisher.ts](src/stream-publisher.ts)               | Stream publication contract    |
| [lib/read-builtin-preference.ts](lib/read-builtin-preference.ts) | Shared preference lookup       |

## Boundaries and integration

The root entry exports types. These are in-process collaboration contracts and may contain SDK types or callbacks; they are not browser wire DTOs. Use pi-rpc-contracts for serialized messages.

Contracts do not create registries, streams, browser engines or a second resource lifecycle.

Related owners:

- [@workbench/pi-sdk-sessions](../pi-sdk-sessions/README.md)
- [@workbench/pi-sdk-models](../pi-sdk-models/README.md)
- [@workbench/pi-runtime-tools](../../pi-runtime/pi-runtime-tools/README.md)
- [@workbench/browser-contracts](../../contracts/browser-contracts/README.md)

## Maintenance and validation

```bash
pnpm --filter @workbench/pi-sdk-ports typecheck
```

Keep implementation in `src/` and consumed internal helpers in `lib/`, preserving the current shallow TypeScript layout. Cross-package references use public exports and `workspace:*`. See the [validation record](../../../docs/package-layout-validation.md) for non-UI regression selection and build checks. Documentation-only edits require entry/path/format checks; UI/DOM/Hook tests and interactive smoke tests remain excluded for this refactor.
