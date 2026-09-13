# @workbench/pi-ui-diagnostics

[中文](README.zh-CN.md) · [Package navigation](../../README.md) · [Layer overview](../README.md)

Pi context Trace and usage-statistics interfaces.

Execution environment: Browser / React.

## Responsibilities

- Show Trace overview/detail/search/timelines and persisted usage statistics.
- Keep detail selection/cache and timeline projections in local helpers.

## Imports

```ts
import { contextTraceExtension, usageStatisticsExtension } from "@workbench/pi-ui-diagnostics";
```

These examples identify public imports. Supply the dependencies and options declared by the entry when constructing services or installing capabilities.

### Public entries and source

[package.json](package.json) `exports` is authoritative. This table lists all current public entries. Source links locate implementations; cross-package code imports the package entry on the left.

| Import path                         | Entry source                             |
| ----------------------------------- | ---------------------------------------- |
| `@workbench/pi-ui-diagnostics`      | [src/index.ts](./src/index.ts)           |
| `@workbench/pi-ui-diagnostics/i18n` | [src/i18n/index.ts](./src/i18n/index.ts) |

## Source navigation

| Location                                                               | Purpose                      |
| ---------------------------------------------------------------------- | ---------------------------- |
| [src/index.ts](src/index.ts)                                           | UI extension exports         |
| [src/use-context-trace.ts](src/use-context-trace.ts)                   | Trace subscription lifecycle |
| [lib/context-trace-detail-cache.ts](lib/context-trace-detail-cache.ts) | Detail cache                 |

## Boundaries and integration

Install the exported UI contributions through the product/extension installation. Keep stable extension IDs and dispose feature subscriptions/openers with their owner.

Dictionaries live with the capability in `src/i18n/`; register the `en-US` and `zh-CN` bundle through the public `/i18n` entry. Reuse shared UI/theme tokens and retain stable translation keys, extension IDs and disposal behavior.

Related owners:

- [@workbench/pi-runtime-client](../../pi-runtime/pi-runtime-client/README.md)
- [@workbench/pi-ui-extensions](../pi-ui-extensions/README.md)

## Maintenance and validation

```bash
pnpm --filter @workbench/pi-ui-diagnostics typecheck
```

Keep implementation in `src/` and consumed internal helpers in `lib/`, preserving the current shallow TypeScript layout. Cross-package references use public exports and `workspace:*`. See the [validation record](../../../docs/package-layout-validation.md) for non-UI regression selection and build checks. Documentation-only edits require entry/path/format checks; UI/DOM/Hook tests and interactive smoke tests remain excluded for this refactor.
