# @workbench/pi-ui-settings

[中文](README.zh-CN.md) · [Package navigation](../../README.md) · [Layer overview](../README.md)

Pi agent configuration and system/append prompt editing UI.

Execution environment: Browser / React.

## Responsibilities

- Own Agent configuration, prompt editors, dynamic placeholder highlighting and cache-miss notices.
- Provide configuration-file actions and the shared Pi settings header contribution.

## Imports

```ts
import { agentConfigurationExtension, piSettingsActionExtension } from "@workbench/pi-ui-settings";
```

These examples identify public imports. Supply the dependencies and options declared by the entry when constructing services or installing capabilities.

### Public entries and source

[package.json](package.json) `exports` is authoritative. This table lists all current public entries. Source links locate implementations; cross-package code imports the package entry on the left.

| Import path                      | Entry source                             |
| -------------------------------- | ---------------------------------------- |
| `@workbench/pi-ui-settings`      | [src/index.ts](./src/index.ts)           |
| `@workbench/pi-ui-settings/i18n` | [src/i18n/index.ts](./src/i18n/index.ts) |

## Source navigation

| Location                                                                                   | Purpose                        |
| ------------------------------------------------------------------------------------------ | ------------------------------ |
| [src/agent-settings-items.tsx](src/agent-settings-items.tsx)                               | Agent configuration controls   |
| [src/prompt-placeholder-highlight.module.css](src/prompt-placeholder-highlight.module.css) | Scoped Custom Highlight styles |
| [lib/prompt-placeholder-highlight.ts](lib/prompt-placeholder-highlight.ts)                 | Highlight range lifecycle      |

## Boundaries and integration

Install the exported UI contributions through the product/extension installation. Keep stable extension IDs and dispose feature subscriptions/openers with their owner.

Model/Provider editing belongs to pi-ui-settings-models. Placeholder highlighting uses the CSS Custom Highlight API; its co-located stylesheet remains scoped to the editor.

Dictionaries live with the capability in `src/i18n/`; register the `en-US` and `zh-CN` bundle through the public `/i18n` entry. Reuse shared UI/theme tokens and retain stable translation keys, extension IDs and disposal behavior.

Related owners:

- [@workbench/pi-ui-settings-models](../pi-ui-settings-models/README.md)
- [@workbench/pi-runtime-client](../../pi-runtime/pi-runtime-client/README.md)
- [@workbench/pi-ui-extensions](../pi-ui-extensions/README.md)

## Maintenance and validation

```bash
pnpm --filter @workbench/pi-ui-settings typecheck
```

Keep implementation in `src/` and consumed internal helpers in `lib/`, preserving the current shallow TypeScript layout. Cross-package references use public exports and `workspace:*`. See the [validation record](../../../docs/package-layout-validation.md) for non-UI regression selection and build checks. Documentation-only edits require entry/path/format checks; UI/DOM/Hook tests and interactive smoke tests remain excluded for this refactor.
