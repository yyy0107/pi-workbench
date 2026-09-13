# Workspace runtime

Owns the headless inspector controller, Surface state, draft and feedback stores, persistence and workspace-directory selection. Use the root for state contracts and installation, `/persistence` for the settings bridge and `/directory-store` for the client directory projection. React, DOM, presentation, translations and styles belong to `@workbench/ui-workspace`.

Registry, opener, validator and persistence ports are immutable installation inputs. One installation owns one controller, state store, feedback store and lazy draft store. Concrete file/browser/terminal Surfaces are supplied by extension registries. Existing IDs, close/retry/dispose rules and persistence formats are preserved.

Source roles: `src/` owns headless capability implementation and contracts, `lib/` contains the legacy storage key, and `tests/` owns non-UI behavior tests. The core has no React, DOM, extension-host, Shell context or UI implementation dependency.

Example consumer: `src/right-workspace-persistence.ts` → `lib/legacy-storage.ts`.
