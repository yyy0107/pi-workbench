# Capability ownership

- Own dictionaries in src/i18n/en-US.ts and zh-CN.ts with matching keys and interpolation parameters. Use the shared i18n runtime and the installed capability bundle.
- Extension, command, renderer and persistence identifiers remain stable. Register descriptors and resolve them at render time.
- Consume workspace packages through public exports. Reuse shared UI and semantic tokens; keep Portal ownership and installation disposal behavior.

Keep real capability code in src and consumed auxiliary modules in lib. Both roots allow at most one subdirectory; retain TS/TSX.
