# Code highlighting

Owns Shiki registration/caches, retained streaming tokenization, literal code surfaces, editor rendering and diff utilities. Use the root public API, `/engine` for asynchronous tokenization, `/header` for diagram headers, `/i18n` to install the translation bundle, and `/styles.css` for standalone surfaces.

Consumers supply the shared i18n and settings Providers. Source text is rendered directly, preserving punctuation and trailing newlines. Mermaid source remains code. No dependency on Markdown, file openers or Shell composition. Run `pnpm --filter @workbench/code-highlighting test` and `typecheck`.

Source roles: src/ owns capability implementation, contracts, components and composition with colocated dictionaries/styles; lib/ contains the internal helpers below; tests/ owns tests. Both source roots allow at most one subdirectory. Capability and helper source remains TypeScript (TS/TSX), checked by the package and its consumers.

Internal helpers: `lib/code-highlight-policy.ts`, `lib/diff/range.ts`, `lib/diff/unified-patch.ts`, `lib/shiki-token-style.ts`.

Example consumer: `src/index.ts` → `lib/code-highlight-policy.ts`.

Code-header control sizing lives in code-block.css beside the header; tool protocol adapters are not part of this rendering capability.
