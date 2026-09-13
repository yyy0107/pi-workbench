# @workbench/workspace-directory-picker

Owns workspace-directory-picker implementation and its bilingual translation bundle. Consumers use the package exports. The product installs the bundle and extension in its existing order. IDs, commands, storage formats and installation lifetimes are preserved. Tests live in tests/.

Source roles: src/ owns capability implementation, contracts, components and composition with colocated dictionaries/styles; lib/ contains the internal helpers below; tests/ owns tests. Both source roots allow at most one subdirectory. Capability and helper source remains TypeScript (TS/TSX), checked by the package and its consumers.

Internal helpers: `lib/new-thread-workspace-policy.ts`, `lib/project-trust-dialog-copy.ts`, `lib/workspace-admission.ts`.

Example consumer: `src/directory-picker-button.tsx` → `lib/project-trust-dialog-copy.ts`.
