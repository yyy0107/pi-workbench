# @workbench/composer

Owns the rich input editor, command documents, tokens and arguments, history, attachments and submission. Message rendering remains in Conversation. Shared conversation preferences use the installation resource in settings-runtime. Capability implementation, public entries, dictionaries and styles are in src; internal auxiliary modules are in lib; tests are in tests. CSS entries preserve the original Shell cascade order.

Source roles: src/ owns capability implementation, contracts, components and composition with colocated dictionaries/styles; lib/ contains the internal helpers below; tests/ owns tests. Both source roots allow at most one subdirectory. Capability and helper source remains TypeScript (TS/TSX), checked by the package and its consumers.

Internal helpers: `lib/agent-command.ts`, `lib/composer-command-argument-hint.ts`, `lib/composer-command-group-order.ts`, `lib/composer-command-icon-color.ts`, `lib/composer-image-paste.ts`, `lib/composer-input-history.ts`, `lib/composer-markdown-detection.ts`, `lib/composer-panel-styles.ts`, `lib/composer-text-paste.ts`, `lib/legacy-pi-compat.ts`.

Example consumer: `src/composer-document.ts` → `lib/legacy-pi-compat.ts`.
