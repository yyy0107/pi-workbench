# @workbench/pi-workbench-runtime

[中文](README.zh-CN.md) · [Package navigation](../../README.md) · [Layer overview](../README.md)

Node product defaults: bundled resources, Pi extension selection and deployment policy.

Execution environment: Node.js / server.

## Responsibilities

- Own product Skills and the Prompt template directory, plus development/artifact resource locations.
- Select default inline extension factories, hidden flags and installation order; keep Trace last.
- Deploy built-in resources, register the Browser package and migrate old paths/enablement state.

## Imports

```ts
import { createWorkbenchInternalPiExtensions } from "@workbench/pi-workbench-runtime/extensions";
import { ensureWorkbenchBuiltinResources } from "@workbench/pi-workbench-runtime/resources";
```

These examples identify public imports. Supply the dependencies and options declared by the entry when constructing services or installing capabilities.

This package has no root entry; select an explicit subpath from the table below.

### Public entries and source

[package.json](package.json) `exports` is authoritative. This table lists all current public entries. Source links locate implementations; cross-package code imports the package entry on the left.

| Import path                                          | Entry source                                             |
| ---------------------------------------------------- | -------------------------------------------------------- |
| `@workbench/pi-workbench-runtime/resources`          | [src/builtin-resources.ts](./src/builtin-resources.ts)   |
| `@workbench/pi-workbench-runtime/resource-locations` | [src/resource-locations.ts](./src/resource-locations.ts) |
| `@workbench/pi-workbench-runtime/extensions`         | [src/extensions.ts](./src/extensions.ts)                 |
| `@workbench/pi-workbench-runtime/builtin-packages`   | [src/builtin-packages.ts](./src/builtin-packages.ts)     |

## Source navigation

| Location                                             | Purpose                                                      |
| ---------------------------------------------------- | ------------------------------------------------------------ |
| [resources/skills](resources/skills)                 | Product Skills                                               |
| [resources/prompts](resources/prompts)               | Product Prompt templates (currently a placeholder directory) |
| [src/extensions.ts](src/extensions.ts)               | Default Agent extension catalog                              |
| [src/builtin-resources.ts](src/builtin-resources.ts) | Deployment and retired-resource cleanup                      |
| [src/builtin-packages.ts](src/builtin-packages.ts)   | Default package registration and migration                   |
| [lib/builtin-files.ts](lib/builtin-files.ts)         | Protected resource file operations                           |

## Boundaries and integration

The package is independent of React, frontend product composition and pi-runtime-server. Server composition selects it and supplies Host collaborators to its tool factories.

Tool implementations live in pi-runtime-tools. Browser owns its companion browser-use skill so it remains independently distributable; this product owns the default installation choice.

Deployment retains .builtin paths and internal-skills/internal-prompts/internal-extensions/internal-packages/browser artifact locations. Keep existing tool IDs, resource switches and migration behavior.

Related owners:

- [@workbench/pi-workbench](../pi-workbench/README.md)
- [@workbench/pi-runtime-tools](../../pi-runtime/pi-runtime-tools/README.md)
- [@workbench/pi-runtime-browser](../../pi-runtime/pi-runtime-browser/README.md)
- [@workbench/pi-sdk-resources](../../pi-sdk/pi-sdk-resources/README.md)
- [@workbench/pi-runtime-server](../../pi-runtime/pi-runtime-server/README.md)

## Maintenance and validation

```bash
pnpm --filter @workbench/pi-workbench-runtime typecheck
```

Keep implementation in `src/` and consumed internal helpers in `lib/`, preserving the current shallow TypeScript layout. Cross-package references use public exports and `workspace:*`. See the [validation record](../../../docs/package-layout-validation.md) for non-UI regression selection and build checks. Documentation-only edits require entry/path/format checks; UI/DOM/Hook tests and interactive smoke tests remain excluded for this refactor.
