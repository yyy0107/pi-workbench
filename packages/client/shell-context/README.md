# Shell context

Shared installation contexts for DOM IDs, navigation, presentation, immutable Runtime connections and running-indicator contracts; includes read-only layout signals and sizing policies. Public subpaths match each capability; the root aggregates them.

Hosts install each Provider once. This package registers no extensions and defines no product branding, animation catalog or mutable process singleton. Run `pnpm --filter @workbench/shell-context test` and `typecheck`.

Source roles: src/ owns capability implementation, contracts, components and composition with colocated dictionaries/styles; lib/ contains the internal helpers below; tests/ owns tests. Both source roots allow at most one subdirectory. Capability and helper source remains TypeScript (TS/TSX), checked by the package and its consumers.

Internal helpers: `lib/layout/thread-content-width.ts`, `lib/workbench-shell-owner.ts`.

Example consumer: `src/dom.tsx` → `lib/workbench-shell-owner.ts`.
