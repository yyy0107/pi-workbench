# @workbench/pi-sdk-models

[中文](README.zh-CN.md) · [Package navigation](../../README.md) · [Layer overview](../README.md)

Pi model/provider services and protected SDK service construction.

Execution environment: Node.js / server.

## Responsibilities

- Manage provider configuration, model discovery, authentication and model capability probes.
- Create cwd-bound SDK services with injected project trust and request-time Trace lookup.
- Retain the existing protected ModelRuntime and credential ownership.

## Imports

```ts
import { ModelService } from "@workbench/pi-sdk-models";
import { createWorkbenchAgentSessionServices } from "@workbench/pi-sdk-models/services";
```

These examples identify public imports. Supply the dependencies and options declared by the entry when constructing services or installing capabilities.

### Public entries and source

[package.json](package.json) `exports` is authoritative. This table lists all current public entries. Source links locate implementations; cross-package code imports the package entry on the left.

| Import path                            | Entry source                                                     |
| -------------------------------------- | ---------------------------------------------------------------- |
| `@workbench/pi-sdk-models`             | [src/model-service.ts](./src/model-service.ts)                   |
| `@workbench/pi-sdk-models/config`      | [src/model-config-store.ts](./src/model-config-store.ts)         |
| `@workbench/pi-sdk-models/services`    | [src/agent-session-services.ts](./src/agent-session-services.ts) |
| `@workbench/pi-sdk-models/image-probe` | [src/image-probe.ts](./src/image-probe.ts)                       |

## Source navigation

| Location                                                       | Purpose                      |
| -------------------------------------------------------------- | ---------------------------- |
| [src/model-service.ts](src/model-service.ts)                   | Model/provider operations    |
| [src/agent-session-services.ts](src/agent-session-services.ts) | SDK services construction    |
| [src/model-config-store.ts](src/model-config-store.ts)         | Configuration persistence    |
| [lib/image-input-probe.ts](lib/image-input-probe.ts)           | Image-input capability probe |

## Boundaries and integration

This package does not own the session registry, product resources or UI settings. Service creation still requires the collaborators described by its exported options.

Related owners:

- [@workbench/pi-sdk-sessions](../pi-sdk-sessions/README.md)
- [@workbench/pi-runtime-server](../../pi-runtime/pi-runtime-server/README.md)

## Maintenance and validation

```bash
pnpm --filter @workbench/pi-sdk-models typecheck
```

Keep implementation in `src/` and consumed internal helpers in `lib/`, preserving the current shallow TypeScript layout. Cross-package references use public exports and `workspace:*`. See the [validation record](../../../docs/package-layout-validation.md) for non-UI regression selection and build checks. Documentation-only edits require entry/path/format checks; UI/DOM/Hook tests and interactive smoke tests remain excluded for this refactor.
