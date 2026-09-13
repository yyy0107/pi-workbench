# Workspace runtime

Owns the inspector controller, Surface and feedback stores, React host, persistence, tabs, resize/presentation and workspace-directory selection. Use the root for controllers, `/react` for installation and resources, `/presentation` for shared views, `/persistence` and `/directory-store` for persistence factories. `/i18n` is neutral; `/translations` is the React translation hook.

Registry, opener, catalog validator and persistence ports are immutable installation inputs. Replacing an installation requires remounting its Provider. Concrete file/browser/terminal Surfaces are supplied by extension registries. Existing IDs, close/retry/dispose rules and persistence formats are preserved. Run `pnpm --filter @workbench/workspace-runtime test` and `typecheck`.

Source roles: src/ owns capability implementation, contracts, components and composition with colocated dictionaries/styles; lib/ contains the internal helpers below; tests/ owns tests. Both source roots allow at most one subdirectory. Capability and helper source remains TypeScript (TS/TSX), checked by the package and its consumers.

Internal helpers: `lib/legacy-storage.ts`, `lib/surface-mount-policy.ts`, `lib/workspace-split-layout.ts`, `lib/workspace-tab-a11y.ts`, `lib/workspace-tab-layout.ts`.

Example consumer: `src/index.ts` → `lib/surface-mount-policy.ts`.
