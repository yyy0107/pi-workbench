# Pi contribution package

`@workbench/agent-runtime-pi-contributions` owns the statically bundled UI contributions that
require Pi runtime/client contracts. Its only public entry point is `./installation`.

The application composition owns transport creation, served asset URLs, branding, URL syntax, and
the final extension activation order. Workbench Shell owns the generic workspace UI, file buffers,
presentation assets, branding, and runtime-connection contexts. This package exports:

- the semantic Pi runtime extension group for application composition;
- `PiAgentRuntimeContributionsProvider`, which supplies only the Pi Skill/Extension resource backend
  to Shell's capability-backed file runtime; Toolbox owns and disposes the four Pi resource openers,
  while Shell's Workspace File extension owns the generic workspace-file opener and surface;
- `piTranslationBundle` and `piRunningIndicatorDefinitions` for explicit application installation.

Shell's file-viewer fallback assets use a reference-counted lease because the library keeps a
process-global default. Concurrent Workbench roots must use the same normalized base URL; a
conflicting base is rejected before it can redirect another root's preset assets. The first lease
captures the baseline and the final release restores it. Shell owns mutable file targets, review
state, file buffers, and terminal hosts. File-buffer drafts use RightWorkspace's generic
`WorkspaceDraftStore`: it defaults to memory per installation, while an app that wants remount
persistence injects an already namespaced `RightWorkspaceDraftPersistencePort` at the RightWorkspace
boundary. Pi side-chat navigation stays semantic and delegates URL syntax to Shell's navigation
port.

Do not import Next, root aliases, Pi server modules, or Extension Host internals from this package.
