# rpiv todo core

Task schema, reducer, status transitions, dependency graph and result formatting are adapted from
`@juicesharp/rpiv-todo` 2.9.0, Copyright (c) 2026 juicesharp, under the included MIT license.
Upstream: https://github.com/juicesharp/rpiv-mono/tree/main/packages/rpiv-todo

Workbench statically registers the `todo` tool in `../todo.ts` and restores its state from current-branch
tool results. The tool name and `details.tasks` / `details.nextId` format remain compatible with rpiv.
Terminal overlays, `/todos`, TUI localization and rpiv configuration are replaced by the existing
Workbench task panel and its shared appearance/i18n settings. No user-installed package is required.
