# @workbench/workspace-browser

Owns the right-workspace browser tab and its bilingual translation bundle. Consumers use the package exports. The product installs the workspace Surface, opener and runtime overlays in its existing order; it does not contribute a Settings section or a model-callable Pi Browser resource. IDs, commands, storage formats and installation lifetimes for the retained tab are preserved. Tests live in tests/.

Source roles: src/ owns capability implementation, contracts, components and composition with colocated dictionaries/styles; lib/ contains the internal helpers below; tests/ owns tests. Both source roots allow at most one subdirectory. Capability and helper source remains TypeScript (TS/TSX), checked by the package and its consumers.

Internal helpers: `lib/browser-files.ts`.

Example consumer: `src/browser-downloads-dialog.tsx` → `lib/browser-files.ts`.
