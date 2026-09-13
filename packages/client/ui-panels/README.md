# @workbench/ui-panels

[中文](README.zh-CN.md)

Workbench panel layout, dock chrome, resizing, and the bottom terminal drawer wrapper.

`src/` owns the panel components and the bilingual translation bundle. `lib/panel-dimensions.ts` contains the panel dimension calculation consumed by `src/panel-container.tsx`. Tests live in `tests/` and enforce the package boundary without rendering UI.

Public imports:

- `@workbench/ui-panels` exports `PanelLayout`, `PanelDock`, `TerminalDrawer`, the panel building blocks, and their public props types.
- `@workbench/ui-panels/i18n` exports `panelsTranslationBundle`.

The package consumes the Extension Host panel service and host components. It does not depend on Shell or terminal UI; `TerminalDrawer` only selects the bottom panel dock and does not own terminal lifecycle.

```bash
pnpm --filter @workbench/ui-panels typecheck
```
