# @workbench/pi-ui-extensions

[中文](README.zh-CN.md) · [Package navigation](../../README.md) · [Layer overview](../README.md)

Pi UI installation groups, translation aggregation and resource integration.

Execution environment: Browser / React.

## Responsibilities

- Export frozen agentConfiguration, configuration, toolbox and diagnostics groups.
- Aggregate Pi translation bundles, resource-provider integration and activity indicator definitions.

## Imports

```ts
import {
  piAgentRuntimeExtensionGroups,
  piTranslationBundles,
} from "@workbench/pi-ui-extensions/installation";
```

These examples identify public imports. Supply the dependencies and options declared by the entry when constructing services or installing capabilities.

This package has no root entry; select an explicit subpath from the table below.

### Public entries and source

[package.json](package.json) `exports` is authoritative. This table lists all current public entries. Source links locate implementations; cross-package code imports the package entry on the left.

| Import path                                | Entry source                                                 |
| ------------------------------------------ | ------------------------------------------------------------ |
| `@workbench/pi-ui-extensions/installation` | [src/public/installation.tsx](./src/public/installation.tsx) |

## Source navigation

| Location                                                   | Purpose                           |
| ---------------------------------------------------------- | --------------------------------- |
| [src/public/installation.tsx](src/public/installation.tsx) | Public group/provider/bundle API  |
| [src/i18n/index.ts](src/i18n/index.ts)                     | Pi translation bundle aggregation |
| [lib/i18n-runtime.ts](lib/i18n-runtime.ts)                 | Dictionary registration helper    |

## Boundaries and integration

Individual UI implementations belong to pi-ui-* packages. pi-workbench interleaves these groups with Shell contributions and owns the final product activation order.

PiAgentRuntimeContributionsProvider supplies Pi resource backends; Shell owns generic file buffers and surfaces. External Session Import is an explicit opt-in contribution, not a default group member.

These are Workbench UI contributions. Agent-executed Pi extension defaults belong to pi-workbench-runtime.

Related owners:

- [@workbench/pi-workbench](../../product/pi-workbench/README.md)
- [@workbench/pi-ui-toolbox](../pi-ui-toolbox/README.md)
- [@workbench/pi-ui-status](../pi-ui-status/README.md)
- [@workbench/pi-ui-session-import](../pi-ui-session-import/README.md)

## Maintenance and validation

```bash
pnpm --filter @workbench/pi-ui-extensions typecheck
```

Keep implementation in `src/` and consumed internal helpers in `lib/`, preserving the current shallow TypeScript layout. Cross-package references use public exports and `workspace:*`. See the [validation record](../../../docs/package-layout-validation.md) for non-UI regression selection and build checks. Documentation-only edits require entry/path/format checks; UI/DOM/Hook tests and interactive smoke tests remain excluded for this refactor.
