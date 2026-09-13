# File presentation

Owns reusable file icons and browser save/download primitives. The icons entry uses an explicitly installed `FilePresentationProvider` for the material icon asset base URL and has no Shell context dependency. The download entry has no React dependency and preserves picker cancellation, Blob URL cleanup, and fallback download behavior.

Public API: `@workbench/ui-file-presentation/icons` and `@workbench/ui-file-presentation/download`.

Run `pnpm --filter @workbench/ui-file-presentation typecheck` and the pure material icon test. UI tests are reviewed but not run during this refactor.
