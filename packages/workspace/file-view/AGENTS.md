# File view ownership

- File-view copy belongs to this package’s `src/i18n/en-US.ts` and `zh-CN.ts`. Use the shared i18n bundle API; keep `extensions.workspaceFile.*` descriptor keys stable for persisted surfaces.
- Keep extension, opener, Surface and overlay IDs stable. Register descriptors, not translated text, during setup.
- Reuse workspace-files for file services, classification, links and local-app preferences. Do not duplicate its implementations or access another package’s source.
- UI, themes and Portal behavior follow the root AGENTS.md; code/Markdown rendering uses their owning public packages.

Source roles: src/ contains real capability implementation/contracts and colocated dictionaries/styles; lib/ contains consumed internal helpers. Do not reduce src to forwarding entries. Keep both capability and helper source in TS/TSX; do not rewrite these modules in JS. Both source roots remain shallow.
