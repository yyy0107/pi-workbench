# Pi contribution package

`@workbench/agent-runtime-pi-contributions` owns the statically bundled UI contributions that
require Pi runtime/client contracts. Its only public entry point is `./installation`.

The application composition owns transport creation, served asset URLs, branding, URL syntax, and
the final extension activation order. Workbench Shell owns the shared Explorer, Review, Terminal,
presentation assets, branding, and runtime-connection contexts. This package exports:

- semantic Pi setup and runtime extension groups for application composition;
- `PiAgentRuntimeContributionsProvider`, which supplies the Pi Workspace File backend to Shell's
  shared file runtime; Workspace File openers are owned and disposed by their extension lifecycle;
- `piTranslationBundle` and `piRunningIndicatorDefinitions` for explicit application installation.

File-viewer fallback assets use a reference-counted lease because the third-party library keeps a
process-global default. Concurrent Workbench roots must use the same normalized base URL; a
conflicting base is rejected before it can redirect another root's preset assets. The first lease
captures the baseline and the final release restores it. Shell owns mutable file targets, review
state, and terminal hosts; Pi's file-buffer backend remains installation-owned until the Workspace
File vertical slice migrates. File-buffer drafts use RightWorkspace's generic
`WorkspaceDraftStore`: it defaults to memory per installation, while an app that wants remount
persistence injects an already namespaced `RightWorkspaceDraftPersistencePort` at the RightWorkspace
boundary. Pi side-chat navigation stays semantic and delegates URL syntax to Shell's navigation
port.

Do not import Next, root aliases, Pi server modules, or Extension Host internals from this package.
