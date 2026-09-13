# @workbench/pi-sdk-resources

[中文](README.zh-CN.md) · [Package navigation](../../README.md) · [Layer overview](../README.md)

Pi resource loading, catalogs, mutations and reload coordination.

Execution environment: Node.js / server.

## Responsibilities

- Serve Skills, Extensions, Packages, Prompts and Commands through explicit APIs.
- Own resource enablement, text-file access, project trust, settings and mutation/reload coordination.
- Adapt workspace protocol operations while reusing the workspace-server catalog owner.

## Imports

```ts
import {
  SkillService,
  ExtensionService,
  InstalledPackageService,
} from "@workbench/pi-sdk-resources";
```

These examples identify public imports. Supply the dependencies and options declared by the entry when constructing services or installing capabilities.

### Public entries and source

[package.json](package.json) `exports` is authoritative. This table lists all current public entries. Source links locate implementations; cross-package code imports the package entry on the left.

| Import path                                                 | Entry source                                                                         |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `@workbench/pi-sdk-resources`                               | [src/index.ts](./src/index.ts)                                                       |
| `@workbench/pi-sdk-resources/internal-extensions`           | [src/internal-extensions.ts](./src/internal-extensions.ts)                           |
| `@workbench/pi-sdk-resources/mutations`                     | [src/pi-resource-mutation-coordinator.ts](./src/pi-resource-mutation-coordinator.ts) |
| `@workbench/pi-sdk-resources/resource-mutations`            | [src/resource-mutations.ts](./src/resource-mutations.ts)                             |
| `@workbench/pi-sdk-resources/resource-text-file`            | [src/resource-text-file.ts](./src/resource-text-file.ts)                             |
| `@workbench/pi-sdk-resources/contexts`                      | [src/scoped-resource-context.ts](./src/scoped-resource-context.ts)                   |
| `@workbench/pi-sdk-resources/builtin-skills`                | [src/builtin-skills.ts](./src/builtin-skills.ts)                                     |
| `@workbench/pi-sdk-resources/skill-enablement`              | [src/skill-enablement.ts](./src/skill-enablement.ts)                                 |
| `@workbench/pi-sdk-resources/skills`                        | [src/skill-service.ts](./src/skill-service.ts)                                       |
| `@workbench/pi-sdk-resources/extension-name`                | [src/extension-name.ts](./src/extension-name.ts)                                     |
| `@workbench/pi-sdk-resources/extensions`                    | [src/extension-service.ts](./src/extension-service.ts)                               |
| `@workbench/pi-sdk-resources/packages`                      | [src/installed-package-service.ts](./src/installed-package-service.ts)               |
| `@workbench/pi-sdk-resources/catalog`                       | [src/package-catalog-service.ts](./src/package-catalog-service.ts)                   |
| `@workbench/pi-sdk-resources/package-resource-details`      | [src/package-resource-details.ts](./src/package-resource-details.ts)                 |
| `@workbench/pi-sdk-resources/package-update-metadata`       | [src/package-update-metadata.ts](./src/package-update-metadata.ts)                   |
| `@workbench/pi-sdk-resources/commands`                      | [src/command-service.ts](./src/command-service.ts)                                   |
| `@workbench/pi-sdk-resources/composer-command-failure`      | [src/composer-command-failure.ts](./src/composer-command-failure.ts)                 |
| `@workbench/pi-sdk-resources/composer-command-planner`      | [src/composer-command-planner.ts](./src/composer-command-planner.ts)                 |
| `@workbench/pi-sdk-resources/pi-composer-command-arguments` | [src/pi-composer-command-arguments.ts](./src/pi-composer-command-arguments.ts)       |
| `@workbench/pi-sdk-resources/pi-composer-command-catalog`   | [src/pi-composer-command-catalog.ts](./src/pi-composer-command-catalog.ts)           |
| `@workbench/pi-sdk-resources/prompt-template-expander`      | [src/prompt-template-expander.ts](./src/prompt-template-expander.ts)                 |
| `@workbench/pi-sdk-resources/prompts`                       | [src/prompt-service.ts](./src/prompt-service.ts)                                     |
| `@workbench/pi-sdk-resources/settings`                      | [src/agent-settings-service.ts](./src/agent-settings-service.ts)                     |
| `@workbench/pi-sdk-resources/trust`                         | [src/project-trust-service.ts](./src/project-trust-service.ts)                       |
| `@workbench/pi-sdk-resources/workspace-paths`               | [src/workspace-paths.ts](./src/workspace-paths.ts)                                   |
| `@workbench/pi-sdk-resources/workspaces`                    | [src/workspace-protocol-service.ts](./src/workspace-protocol-service.ts)             |

## Source navigation

| Location                                                                           | Purpose                          |
| ---------------------------------------------------------------------------------- | -------------------------------- |
| [src/skill-service.ts](src/skill-service.ts)                                       | Skill service                    |
| [src/extension-service.ts](src/extension-service.ts)                               | Extension service                |
| [src/installed-package-service.ts](src/installed-package-service.ts)               | Installed package service        |
| [src/pi-resource-mutation-coordinator.ts](src/pi-resource-mutation-coordinator.ts) | Mutation and reload coordination |
| [lib/resource-mutations.ts](lib/resource-mutations.ts)                             | Path and enablement helpers      |

## Boundaries and integration

Product Skills/Prompts, default extension selection and deployment belong to pi-workbench-runtime. The builtin-skills entry loads already installed resources; builtin-packages identifies protected installed sources. Neither entry carries product resource files.

Server composition injects session access, resource contexts, tools and publishers. Do not instantiate a second coordinator or import the full server registry into a resource service.

Related owners:

- [@workbench/pi-workbench-runtime](../../product/pi-workbench-runtime/README.md)
- [@workbench/pi-runtime-server](../../pi-runtime/pi-runtime-server/README.md)
- [@workbench/workspace-server](../../server/workspace-server/README.md)

## Maintenance and validation

```bash
pnpm --filter @workbench/pi-sdk-resources typecheck
```

Keep implementation in `src/` and consumed internal helpers in `lib/`, preserving the current shallow TypeScript layout. Cross-package references use public exports and `workspace:*`. See the [validation record](../../../docs/package-layout-validation.md) for non-UI regression selection and build checks. Documentation-only edits require entry/path/format checks; UI/DOM/Hook tests and interactive smoke tests remain excluded for this refactor.
