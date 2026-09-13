# Capability ownership

- Own dictionaries in src/i18n/en-US.ts and zh-CN.ts with matching keys and interpolation parameters. Use the shared i18n runtime and the installed capability bundle.
- Extension, command, renderer and persistence identifiers remain stable. Register descriptors and resolve them at render time.
- Consume workspace packages through public exports. Reuse shared UI and semantic tokens; keep Portal ownership and installation disposal behavior.
- Keep the Browser contribution limited to the right-workspace Surface, opener and runtime overlays. Do not register a Settings section or Pi agent Browser resource from this package.

Source roles: src/ contains real capability implementation/contracts and colocated dictionaries/styles; lib/ contains consumed internal helpers. Do not reduce src to forwarding entries. Keep both capability and helper source in TS/TSX; do not rewrite these modules in JS. Both source roots remain shallow.
