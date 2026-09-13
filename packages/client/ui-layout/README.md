# @workbench/ui-layout

[中文](README.zh-CN.md)

Workbench frame, header, sidebar frame, global layer, status bar, responsive layout lifecycle, and brand toggle extension.

`src/` owns the visible frame and its bilingual `workbench.shell` translation bundle. `lib/` contains the layout-motion and native-window-resize observers consumed by `WorkbenchShell`. Existing UI tests are retained in `tests/`; they are excluded from execution by the current migration policy.

Public imports:

- `@workbench/ui-layout` exports `WorkbenchShell` and its public props types.
- `@workbench/ui-layout/extension` exports `workbenchBrandExtension`.
- `@workbench/ui-layout/i18n` exports `layoutTranslationBundle`.
- `@workbench/ui-layout/statusbar` exports `WorkbenchStatusbar`.
- `@workbench/ui-layout/styles.css` provides the scoped frame layout and motion styles.

The layout consumes sidebar and panel capabilities through their public packages. It does not depend on Shell or Pi product assembly.

```bash
pnpm --filter @workbench/ui-layout typecheck
```

Layout consumes conversationHeader and conversationActions supplied by Shell. It no longer installs conversation scroll persistence or imports conversation feature packages.
