# @workbench/settings-runtime

Installation-scoped React settings port and disposable presentation resources. Import the public package entry. Each Provider snapshots its settings service and owns its resource cache; Strict Effects replays preserve resources until the real unmount. Settings pages are owned by their UI capability.

Run `pnpm --filter @workbench/settings-runtime typecheck` and `pnpm --filter @workbench/settings-runtime test`.

Source roles: src/ owns capability implementation, contracts, components and composition with colocated dictionaries/styles; lib/ contains the internal helpers below; tests/ owns tests. Both source roots allow at most one subdirectory. Capability and helper source remains TypeScript (TS/TSX), checked by the package and its consumers.

Internal helpers: `lib/dispose-resources.ts`.

Example consumer: `src/index.tsx` → `lib/dispose-resources.ts`.
