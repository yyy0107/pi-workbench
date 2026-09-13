# @workbench/pi-ui-toolbox

[中文](README.zh-CN.md) · [Package navigation](../../README.md) · [Layer overview](../README.md)

Pi resource-management UI, resource file integration and Pi tool presentation.

Execution environment: Browser / React.

## Responsibilities

- Manage Skills, Extensions, Packages and Prompts through the public Pi client APIs.
- Own Pi resource backends/openers and skill-reading/file-mutation presentations.

## Imports

```ts
import { toolboxExtension, skillReadingExtension } from "@workbench/pi-ui-toolbox";
```

These examples identify public imports. Supply the dependencies and options declared by the entry when constructing services or installing capabilities.

### Public entries and source

[package.json](package.json) `exports` is authoritative. This table lists all current public entries. Source links locate implementations; cross-package code imports the package entry on the left.

| Import path                      | Entry source                             |
| -------------------------------- | ---------------------------------------- |
| `@workbench/pi-ui-toolbox`       | [src/index.ts](./src/index.ts)           |
| `@workbench/pi-ui-toolbox/i18n`  | [src/i18n/index.ts](./src/i18n/index.ts) |
| `@workbench/pi-ui-toolbox/files` | [src/files.ts](./src/files.ts)           |

## Source navigation

| Location                                                           | Purpose                         |
| ------------------------------------------------------------------ | ------------------------------- |
| [src/toolbox-extension.ts](src/toolbox-extension.ts)               | Toolbox contribution            |
| [src/files.ts](src/files.ts)                                       | Pi resource file integration    |
| [src/file-runtime-provider.tsx](src/file-runtime-provider.tsx)     | Resource backend provider       |
| [lib/file-mutation-tool-model.ts](lib/file-mutation-tool-model.ts) | Pi file-tool presentation model |

## Boundaries and integration

Install the exported UI contributions through the product/extension installation. Keep stable extension IDs and dispose feature subscriptions/openers with their owner.

Shell owns generic buffers, drafts, diffs and workspace surfaces. This package supplies Pi resource backends and Pi-specific tool metadata; generic ui-tool does not infer Pi protocol payloads.

Dictionaries live with the capability in `src/i18n/`; register the `en-US` and `zh-CN` bundle through the public `/i18n` entry. Reuse shared UI/theme tokens and retain stable translation keys, extension IDs and disposal behavior.

Related owners:

- [@workbench/pi-runtime-client](../../pi-runtime/pi-runtime-client/README.md)
- [@workbench/pi-ui-extensions](../pi-ui-extensions/README.md)
- [@workbench/workspace-files](../../workspace/workspace-files/README.md)

## Maintenance and validation

```bash
pnpm --filter @workbench/pi-ui-toolbox typecheck
```

Keep implementation in `src/` and consumed internal helpers in `lib/`, preserving the current shallow TypeScript layout. Cross-package references use public exports and `workspace:*`. See the [validation record](../../../docs/package-layout-validation.md) for non-UI regression selection and build checks. Documentation-only edits require entry/path/format checks; UI/DOM/Hook tests and interactive smoke tests remain excluded for this refactor.
