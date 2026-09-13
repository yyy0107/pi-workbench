# @workbench/workspace-artifact

Owns workspace-artifact implementation and its bilingual translation bundle. Consumers use the package exports. The product installs the bundle and extension in its existing order. IDs, commands, storage formats and installation lifetimes are preserved. Tests live in tests/.

Source roles: src/ owns capability implementation, contracts, components and composition with colocated dictionaries/styles; lib/ contains the internal helpers below; tests/ owns tests. Both source roots allow at most one subdirectory. Capability and helper source remains TypeScript (TS/TSX), checked by the package and its consumers.

Internal helpers: `lib/artifact-storage-key.ts`.

Example consumer: `src/artifact-preview-service.ts` → `lib/artifact-storage-key.ts`.
