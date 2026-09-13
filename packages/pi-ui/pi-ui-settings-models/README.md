# @workbench/pi-ui-settings-models

[中文](README.zh-CN.md) · [Package navigation](../../README.md) · [Layer overview](../README.md)

Pi Provider authentication and model configuration UI.

Execution environment: Browser / React.

## Responsibilities

- Edit providers and models, authenticate providers, test model capabilities and display feedback.
- Keep draft state, autosave coordination and credential links with the feature.

## Imports

```ts
import {
  settingModelConfigExtension,
  ModelConfigSettingsItem,
} from "@workbench/pi-ui-settings-models";
```

These examples identify public imports. Supply the dependencies and options declared by the entry when constructing services or installing capabilities.

### Public entries and source

[package.json](package.json) `exports` is authoritative. This table lists all current public entries. Source links locate implementations; cross-package code imports the package entry on the left.

| Import path                             | Entry source                             |
| --------------------------------------- | ---------------------------------------- |
| `@workbench/pi-ui-settings-models`      | [src/index.ts](./src/index.ts)           |
| `@workbench/pi-ui-settings-models/i18n` | [src/i18n/index.ts](./src/i18n/index.ts) |

## Source navigation

| Location                                                                 | Purpose                    |
| ------------------------------------------------------------------------ | -------------------------- |
| [src/model-config-settings-item.tsx](src/model-config-settings-item.tsx) | Provider/model settings UI |
| [src/use-model-config-autosave.ts](src/use-model-config-autosave.ts)     | Autosave orchestration     |
| [lib/model-config-draft.ts](lib/model-config-draft.ts)                   | Draft transformations      |

## Boundaries and integration

Install the exported UI contributions through the product/extension installation. Keep stable extension IDs and dispose feature subscriptions/openers with their owner.

Dictionaries live with the capability in `src/i18n/`; register the `en-US` and `zh-CN` bundle through the public `/i18n` entry. Reuse shared UI/theme tokens and retain stable translation keys, extension IDs and disposal behavior.

Related owners:

- [@workbench/pi-ui-settings](../pi-ui-settings/README.md)
- [@workbench/pi-runtime-client](../../pi-runtime/pi-runtime-client/README.md)
- [@workbench/pi-sdk-models](../../pi-sdk/pi-sdk-models/README.md)

## Maintenance and validation

```bash
pnpm --filter @workbench/pi-ui-settings-models typecheck
```

Keep implementation in `src/` and consumed internal helpers in `lib/`, preserving the current shallow TypeScript layout. Cross-package references use public exports and `workspace:*`. See the [validation record](../../../docs/package-layout-validation.md) for non-UI regression selection and build checks. Documentation-only edits require entry/path/format checks; UI/DOM/Hook tests and interactive smoke tests remain excluded for this refactor.
