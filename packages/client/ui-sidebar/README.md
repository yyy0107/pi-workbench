# @workbench/ui-sidebar

Owns the conversation and workspace sidebar capability, including ordered thread/workspace lists, drag and drop policy, conversation actions, and the workspace sidebar extension. `src` contains the capability and its contracts; `lib` contains the consumed thread sorting helper; tests remain at the package root.

The package uses the shared `@workbench/i18n` runtime through its `sidebarTranslationBundle`. Shell installs the bundle alongside other capability bundles; this package does not import Shell i18n or aggregate messages.
