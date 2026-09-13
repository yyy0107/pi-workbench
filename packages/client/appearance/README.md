# Appearance

Owns appearance preferences, theme selection, font stacks and the installation-scoped settings store. Consumers use `@workbench/appearance`; font CSS helpers use `/fonts`. React and the settings port are supplied by the host. No feature UI is registered here.

Persisted keys and legacy migrations retain their existing meaning. Tests cover parsing, migration, asynchronous hydration, local edits and disposal. Run `pnpm --filter @workbench/appearance test` and `typecheck`.

Source roles: src/ owns capability implementation, contracts, components and composition with colocated dictionaries/styles; lib/ contains the internal helpers below; tests/ owns tests. Both source roots allow at most one subdirectory. Capability and helper source remains TypeScript (TS/TSX), checked by the package and its consumers.

Internal helpers: `lib/legacy-preferences.ts`.

Example consumer: `src/appearance-preferences.ts` → `lib/legacy-preferences.ts`.
