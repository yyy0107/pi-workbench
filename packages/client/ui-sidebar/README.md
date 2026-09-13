# @workbench/ui-sidebar

Owns the conversation and workspace sidebar capability, including the shared Sidebar primitives, row presentation, pointer reorder coordinator, ordered thread/workspace lists, conversation actions, and the workspace sidebar extension. `src/primitives.ts` and `src/use-sidebar-pointer-reorder.tsx` are narrow public entries; `lib` contains the consumed thread sorting helper; tests remain at the package root.

The package uses the shared `@workbench/i18n` runtime through its `sidebarTranslationBundle`. Shell installs the bundle alongside other capability bundles; this package does not import Shell i18n or aggregate messages.
