# @workbench/pi-ui-status

[中文](README.zh-CN.md) · [Package navigation](../../README.md) · [Layer overview](../README.md)

Pi About, version/connection status and activity indicators.

Execution environment: Browser / React.

## Responsibilities

- Expose About and connection status contributions.
- Provide activity-indicator definitions/renderers while retaining persisted style IDs.

## Imports

```ts
import { aboutExtension, connectionStatusExtension } from "@workbench/pi-ui-status";
```

These examples identify public imports. Supply the dependencies and options declared by the entry when constructing services or installing capabilities.

### Public entries and source

[package.json](package.json) `exports` is authoritative. This table lists all current public entries. Source links locate implementations; cross-package code imports the package entry on the left.

| Import path                                 | Entry source                                                   |
| ------------------------------------------- | -------------------------------------------------------------- |
| `@workbench/pi-ui-status`                   | [src/index.ts](./src/index.ts)                                 |
| `@workbench/pi-ui-status/i18n`              | [src/i18n/index.ts](./src/i18n/index.ts)                       |
| `@workbench/pi-ui-status/running-indicator` | [src/pi-running-indicator.tsx](./src/pi-running-indicator.tsx) |

## Source navigation

| Location                                                     | Purpose                  |
| ------------------------------------------------------------ | ------------------------ |
| [src/index.ts](src/index.ts)                                 | Status extension exports |
| [src/pi-running-indicator.tsx](src/pi-running-indicator.tsx) | Activity indicator API   |
| [lib/wordmark-pixels.ts](lib/wordmark-pixels.ts)             | Shared wordmark geometry |

## Boundaries and integration

Install the exported UI contributions through the product/extension installation. Keep stable extension IDs and dispose feature subscriptions/openers with their owner.

Dictionaries live with the capability in `src/i18n/`; register the `en-US` and `zh-CN` bundle through the public `/i18n` entry. Reuse shared UI/theme tokens and retain stable translation keys, extension IDs and disposal behavior.

Related owners:

- [@workbench/pi-ui-extensions](../pi-ui-extensions/README.md)
- [@workbench/pi-workbench](../../product/pi-workbench/README.md)
- [@workbench/pi-runtime-client](../../pi-runtime/pi-runtime-client/README.md)

## Maintenance and validation

```bash
pnpm --filter @workbench/pi-ui-status typecheck
```

Keep implementation in `src/` and consumed internal helpers in `lib/`, preserving the current shallow TypeScript layout. Cross-package references use public exports and `workspace:*`. See the [validation record](../../../docs/package-layout-validation.md) for non-UI regression selection and build checks. Documentation-only edits require entry/path/format checks; UI/DOM/Hook tests and interactive smoke tests remain excluded for this refactor.
