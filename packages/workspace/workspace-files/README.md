# Workspace files

Owns file services/buffers, ExplorerTree, FileLink/menu, local application selection/preferences, and shared file classification. File icons and browser save/download primitives come from `@workbench/ui-file-presentation`. Public API: root services; `/tree`, `/links`, `/classification`, `/open-apps`, `/open-preferences`, `/app-icon`, `/markdown-links` and `/i18n`.

Product installs the files translation bundle and injects the workspace Markdown adapter. FileLink uses the existing registered opener; it does not import a viewer. Save-before-browser, unsaved buffers, path/location parsing and local-app preferences retain their existing behavior. Document-preview asset leases belong to file-view. Run `pnpm --filter @workbench/workspace-files test` and `typecheck`.

Source roles: src/ owns capability implementation, contracts, components and composition with colocated dictionaries/styles; lib/ contains the internal helpers below; tests/ owns tests. Both source roots allow at most one subdirectory. Capability and helper source remains TypeScript (TS/TSX), checked by the package and its consumers.

Internal helpers: `lib/asset-module-url.ts`, `lib/file-classification.ts`, `lib/file-link-content.ts`, `lib/tree/file-name-parts.ts`.

Example consumer: `src/file-link-menu.tsx` → `lib/file-link-content.ts`.
