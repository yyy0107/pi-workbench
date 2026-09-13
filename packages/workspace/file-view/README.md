# Workspace file view

Registers `workbench.workspace-file`, its `file` Surface, opener and overlay bridge. Owns text/code/diff/Markdown/media/document rendering, progressive documents, edits and preview asset leases. Root exports extension definitions; `/opener`, `/openers`, `/surface` and `/i18n` expose the corresponding contracts.

File services, links and local-app preferences come from workspace-files. Translation descriptor keys retain `extensions.workspaceFile.*` for persisted state compatibility. Two-tab replacement, dirty-buffer preservation, resource deduplication and registration disposal stay unchanged. Assets retain the application-provided base URL. Run `pnpm --filter @workbench/workspace-file-view test` and `typecheck`.

Source roles: src/ owns capability implementation, contracts, components and composition with colocated dictionaries/styles; lib/ contains the internal helpers below; tests/ owns tests. Both source roots allow at most one subdirectory. Capability and helper source remains TypeScript (TS/TSX), checked by the package and its consumers.

Internal helpers: `lib/file-breadcrumb-model.ts`, `lib/file-buffer-draft.ts`, `lib/file-view-mode.ts`, `lib/progressive-text-document.ts`, `lib/virtualized-code-window.ts`.

Example consumer: `src/file-breadcrumb-tree.tsx` → `lib/file-breadcrumb-model.ts`.
