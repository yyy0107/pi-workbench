# @workbench/extension-host

[中文](README.zh-CN.md)

Extension installation, lifecycle, services and UI hosts.

`src/` owns the capability, contracts and composition. `lib/` contains consumed internal helpers: `lib/breadcrumbs.ts`. Tests live in `tests/`. Capability and helper code stays TypeScript/TSX; existing build tooling keeps its language. Both source directories allow at most one child directory.

Public imports: `@workbench/extension-host`, `@workbench/extension-host/internal`, `@workbench/extension-host/installation`, `@workbench/extension-host/services`, `@workbench/extension-host/command-palette`, `@workbench/extension-host/i18n/en-US`, `@workbench/extension-host/i18n/zh-CN`, `@workbench/extension-host/hosts/extension-error-boundary`, `@workbench/extension-host/hosts/main-view-host`, `@workbench/extension-host/hosts/main-view-sidebar-host`, `@workbench/extension-host/hosts/panel-host`, `@workbench/extension-host/hosts/renderer-host`, `@workbench/extension-host/hosts/slot-host`, `@workbench/extension-host/hosts/sidebar-section-host`. Cross-package consumers use explicit exports and `workspace:*` dependencies.

```bash
pnpm --filter @workbench/extension-host typecheck
pnpm --filter @workbench/extension-host test
```

Source layout: src owns this capability and its contracts; lib contains consumed internal helpers; tests live at the package root. Example consumer: `src/services/main-view-service.ts` imports `lib/breadcrumbs.ts`. Capability and helper code remains TS/TSX; existing build tooling retains its language.
