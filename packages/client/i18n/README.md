# @workbench/i18n

Shared translation runtime and controlled React Provider. Locale identities come from @workbench/core-contracts/locale. A runtime starts with an empty catalog; explicitly install immutable translation bundles and use their typed message factories/hooks. Dictionaries stay with their owning capabilities. Each provider installation owns its catalog and rejects changed bundle identities.

The application owns settings hydration, persistence, document language and cookies. Runtime instances do not register process-wide dictionaries.

Source roles: src/ owns capability implementation, contracts, components and composition with colocated dictionaries/styles; lib/ contains the internal helpers below; tests/ owns tests. Both source roots allow at most one subdirectory. Capability and helper source remains TypeScript (TS/TSX), checked by the package and its consumers.

Internal helpers: `lib/catalog-tree.ts`.

Example consumer: `src/runtime.ts` → `lib/catalog-tree.ts`.

Capability catalogs live in `src/i18n/{index,en-US,zh-CN}.ts` and expose a React-free `./i18n` package entry. Components import that bundle and call the shared `useI18n(bundle)` directly; no per-capability hook wrappers are needed. The overload narrows `t` to the bundle while retaining installed descriptor resolution, formatters and `setLocale`. Calling `useI18n()` preserves the global context API. `useTranslationBundle(bundle)` remains available for its narrower formatter/translation view.
