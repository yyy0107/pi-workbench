# Pi contribution package

`@workbench/agent-runtime-pi-contributions` owns the statically bundled UI contributions that
require Pi runtime/client contracts. Its only public entry point is `./installation`.

The application composition owns transport creation, served asset URLs, branding, URL syntax, and
the final extension activation order. This package receives those through public ports and exports:

- semantic Pi extension groups, so an application can interleave Shell and Pi owners without
  changing equal-order registry behavior;
- `PiAgentRuntimeContributionsProvider`, which receives Pi file-viewer assets, Pi branding,
  openers, and a runtime connection;
- `piTranslationBundle`, `PiSettingsConfigurationMenu`, and `piRunningIndicatorDefinitions` for
  explicit application installation.

Pi file-viewer fallback assets use a reference-counted lease because the third-party library keeps
a process-global default. Concurrent Pi roots must use the same normalized base URL; a conflicting
base is rejected before it can redirect another root's preset assets. The first lease captures the
baseline and the final release restores it. Mutable file targets, review state, terminal hosts, and
file-buffer drafts are installation-owned. File-buffer drafts use RightWorkspace's generic
`WorkspaceDraftStore`: it defaults to memory per installation, while an app that wants remount
persistence injects an already namespaced `RightWorkspaceDraftPersistencePort` at the RightWorkspace
boundary. Pi side-chat navigation,
meanwhile, stays semantic and delegates URL syntax to Shell's navigation port.

Do not import Next, root aliases, Pi server modules, or Extension Host internals from this package.
