# Workbench Pi extension resources

[简体中文](README.zh-CN.md)

Each directory owns real Pi registration and lifecycle behavior. Tool schemas, execution, state,
result formatting, and attribution stay alongside their implementation under `src/<tool-name>/`.

| Resource                                            | Responsibility                                               |
| --------------------------------------------------- | ------------------------------------------------------------ |
| [builtin-tools](builtin-tools/index.ts)             | Bind built-in tool preferences and call guards               |
| [ask-user](ask-user/index.ts)                       | Register Ask User with the existing availability policy      |
| [rpiv-todo](rpiv-todo/index.ts)                     | Register Todo and restore/clean session state                |
| [workbench-settings](workbench-settings/index.ts)   | Register settings only when the host supplies the capability |
| [workspace-review](workspace-review/index.ts)       | Capture workspace snapshots around agent runs                |
| [composer-context](composer-context/index.ts)       | Project recorded composer context for model input            |
| [message-termination](message-termination/index.ts) | Classify final assistant messages                            |
| [context-trace](context-trace/index.ts)             | Observe prompts, compaction, provider traffic, and output    |

The product's [composition](../../src/extensions.ts) statically imports these factories, injects
Workbench collaborators, and passes named inline extensions to the SDK. Trace remains last.
Host-dependent factories require their existing explicit dependencies; this directory is not a
standalone Pi package. Do not separately register these files through discovery: that would duplicate
registration and bypass product dependency injection. Names, hidden flags, and enablement are unchanged.

The shared snapshot allowlist copies this directory to
`internal-extensions/resources/extensions/`, then to `extensions/.builtin/resources/extensions/`.
These are inspectable source snapshots; executable factories are bundled in the Runtime.
