# @workbench/ui

Shared controls, semantic tokens, Portal ownership, clipboard, resize, keyboard ownership and disclosure helpers. Public subpaths are explicit in package.json. Business file actions remain with workspace-files. UI copy uses the installed uiTranslationBundle from @workbench/ui/i18n.

Shell assembles component CSS and global tokens in the original cascade order. Standalone owners may import @workbench/ui/styles.css. Keep overlays in WorkbenchPortalContainerProvider and use the existing density, radius and color tokens.

Source roles: src/ owns capability implementation, contracts, components and composition with colocated dictionaries/styles; lib/ contains the internal helpers below; tests/ owns tests. Both source roots allow at most one subdirectory. Capability and helper source remains TypeScript (TS/TSX), checked by the package and its consumers.

Internal helpers: `lib/clipboard.ts`, `lib/components/model-selector-models.ts`, `lib/disclosure/disclosure-scroll-policy.ts`, `lib/keyboard-shortcut-owner.ts`, `lib/resize/observe-resize-handle.ts`, `lib/resize/proportional-panel-size.ts`, `lib/resize/resize-spring.ts`, `lib/utils.ts`.

Example consumer: `src/components/avatar.tsx` → `lib/utils.ts`.
