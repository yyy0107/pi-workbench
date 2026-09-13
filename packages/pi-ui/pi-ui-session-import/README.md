# @workbench/pi-ui-session-import

[中文](README.zh-CN.md) · [Package navigation](../../README.md) · [Layer overview](../README.md)

Opt-in UI for scanning and importing external sessions.

Execution environment: Browser / React.

## Responsibilities

- Present external session sources, selection and bounded import batches.
- Delegate source parsing and durable session import to Runtime APIs.

## Imports

```ts
import { externalSessionImportExtension } from "@workbench/pi-ui-session-import";
```

These examples identify public imports. Supply the dependencies and options declared by the entry when constructing services or installing capabilities.

### Public entries and source

[package.json](package.json) `exports` is authoritative. This table lists all current public entries. Source links locate implementations; cross-package code imports the package entry on the left.

| Import path                            | Entry source                             |
| -------------------------------------- | ---------------------------------------- |
| `@workbench/pi-ui-session-import`      | [src/index.ts](./src/index.ts)           |
| `@workbench/pi-ui-session-import/i18n` | [src/i18n/index.ts](./src/i18n/index.ts) |

## Source navigation

| Location                                                                                       | Purpose                |
| ---------------------------------------------------------------------------------------------- | ---------------------- |
| [src/external-session-import-extension.ts](src/external-session-import-extension.ts)           | Extension contribution |
| [src/external-session-import-settings-item.tsx](src/external-session-import-settings-item.tsx) | Import settings UI     |
| [lib/import-selection.ts](lib/import-selection.ts)                                             | Selection/batch helper |

## Boundaries and integration

Install the exported UI contributions through the product/extension installation. Keep stable extension IDs and dispose feature subscriptions/openers with their owner.

This contribution is opt-in; it is not present in the default piAgentRuntimeExtensionGroups. A product that needs import UI must install it explicitly.

Dictionaries live with the capability in `src/i18n/`; register the `en-US` and `zh-CN` bundle through the public `/i18n` entry. Reuse shared UI/theme tokens and retain stable translation keys, extension IDs and disposal behavior.

Related owners:

- [@workbench/pi-runtime-client](../../pi-runtime/pi-runtime-client/README.md)
- [@workbench/pi-sdk-sessions](../../pi-sdk/pi-sdk-sessions/README.md)
- [@workbench/pi-ui-extensions](../pi-ui-extensions/README.md)

## Maintenance and validation

```bash
pnpm --filter @workbench/pi-ui-session-import typecheck
```

Keep implementation in `src/` and consumed internal helpers in `lib/`, preserving the current shallow TypeScript layout. Cross-package references use public exports and `workspace:*`. See the [validation record](../../../docs/package-layout-validation.md) for non-UI regression selection and build checks. Documentation-only edits require entry/path/format checks; UI/DOM/Hook tests and interactive smoke tests remain excluded for this refactor.
