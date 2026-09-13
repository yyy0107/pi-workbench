# @workbench/i18n

Shared translation runtime and controlled React Provider. Locale identities come from @workbench/contracts/locale. A runtime starts with an empty catalog; explicitly install immutable translation bundles and use their typed message factories/hooks. Dictionaries stay with their owning capabilities. Each provider installation owns its catalog and rejects changed bundle identities.

The application owns settings hydration, persistence, document language and cookies. Runtime instances do not register process-wide dictionaries.

Source roles: src/ owns capability implementation, contracts, components and composition with colocated dictionaries/styles; lib/ contains the internal helpers below; tests/ owns tests. Both source roots allow at most one subdirectory. Capability and helper source remains TypeScript (TS/TSX), checked by the package and its consumers.

Internal helpers: `lib/catalog-tree.ts`.

Example consumer: `src/runtime.ts` → `lib/catalog-tree.ts`.
