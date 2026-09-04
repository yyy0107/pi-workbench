# Pi contribution package

`@workbench/agent-runtime-pi-contributions` owns Agent Configuration, Provider/Model Configuration,
Pi Settings, Toolbox, Context Trace, External Session Import, Pi Version/Connection Status, and Pi
running indicators and branding. Its only public entry point is `./installation`.

The application composition owns transport creation, served asset URLs, branding, URL syntax, and
the final extension activation order. Workbench Shell owns the generic workspace UI, file buffers,
presentation assets, branding, and runtime-connection contexts. This package exports:

- the frozen `agentConfiguration`, `configuration`, `toolbox`, and `diagnostics` extension groups;
- `PiAgentRuntimeContributionsProvider`, which supplies only the Pi Skill/Extension resource backend
  to Shell's capability-backed file runtime; Toolbox owns and disposes the four Pi resource openers,
  while Shell's Workspace File extension owns the generic workspace-file opener and surface;
- `piTranslationBundle` and `piRunningIndicatorDefinitions` for explicit application installation.

Web and Desktop interleave these groups with Shell's groups in the original extension ID order.
The provider only binds the Pi resource backend; Shell owns file buffers, diffs, drafts, asset
leases, workspace targets, navigation, and runtime-connection contexts. Generic workspace and
session features live in Shell and consume Workbench capabilities from the installed Pi Runtime.

Do not import Next, root aliases, Pi server modules, or Extension Host internals from this package.
