# @workbench/pi-workbench

[中文](README.zh-CN.md) · [Package navigation](../../README.md) · [Layer overview](../README.md)

Browser/React product composition shared by Web and Electron renderer.

Execution environment: Browser / React.

## Responsibilities

- Compose Shell providers, Pi UI bundles, branding and default activity indicators.
- Select the final UI contribution order and append platform-specific extensions.
- Create installation-scoped transport and shared settings/Host/workspace/automation clients.

## Imports

```ts
import {
  PiWorkbenchApplicationProviders,
  PiWorkbenchShell,
} from "@workbench/pi-workbench/application";
import { createInstalledAgentRuntime } from "@workbench/pi-workbench/installation";
```

These examples identify public imports. Supply the dependencies and options declared by the entry when constructing services or installing capabilities.

This package has no root entry; select an explicit subpath from the table below.

### Public entries and source

[package.json](package.json) `exports` is authoritative. This table lists all current public entries. Source links locate implementations; cross-package code imports the package entry on the left.

| Import path                            | Entry source                                   |
| -------------------------------------- | ---------------------------------------------- |
| `@workbench/pi-workbench/application`  | [src/application.tsx](./src/application.tsx)   |
| `@workbench/pi-workbench/installation` | [src/installation.tsx](./src/installation.tsx) |

## Source navigation

| Location                                                       | Purpose                                  |
| -------------------------------------------------------------- | ---------------------------------------- |
| [src/application.tsx](src/application.tsx)                     | Product provider and Shell               |
| [src/installation.tsx](src/installation.tsx)                   | Runtime transport and installation       |
| [src/extensions.ts](src/extensions.ts)                         | Final UI extension order                 |
| [src/settings.ts](src/settings.ts)                             | Shared settings client                   |
| [lib/thinking-orb-renderer.tsx](lib/thinking-orb-renderer.tsx) | Activity indicator implementation helper |

## Boundaries and integration

This is the frontend product package. Node built-in resource deployment and default Agent extensions belong to pi-workbench-runtime.

Each installation retains its own runtime connection and client instances. Reuse those instances through the installed capabilities instead of creating parallel service clients in UI components.

Related owners:

- [@workbench/pi-workbench-runtime](../pi-workbench-runtime/README.md)
- [@workbench/pi-ui-extensions](../../pi-ui/pi-ui-extensions/README.md)
- [@workbench/pi-runtime-client](../../pi-runtime/pi-runtime-client/README.md)
- [@workbench/shell](../../client/shell/README.md)

## Maintenance and validation

```bash
pnpm --filter @workbench/pi-workbench typecheck
```

Keep implementation in `src/` and consumed internal helpers in `lib/`, preserving the current shallow TypeScript layout. Cross-package references use public exports and `workspace:*`. See the [validation record](../../../docs/package-layout-validation.md) for non-UI regression selection and build checks. Documentation-only edits require entry/path/format checks; UI/DOM/Hook tests and interactive smoke tests remain excluded for this refactor.
