# Workspace UI

Owns the React installation adapter, hooks, surface hosts, workspace tabs, feedback forms, resize behavior, presentation styles and translations for the right workspace. Use the root for presentation geometry, `/react` for providers and hooks, `/presentation` for shared views, `/i18n` for the translation bundle and `/styles.css` for Shell styling.

The package consumes one headless `@workbench/workspace-runtime` installation. React owns Strict Effects timing and presentation resources; the runtime installation remains the single owner of controller, state, drafts and feedback and disposes them together.

Source roles: `src/` owns React composition and presentation, `lib/` contains presentation-specific pure calculations, and `tests/` contains existing UI-associated tests. UI, DOM, Hook-rendering and browser tests are not run during the package-boundary refactor.
