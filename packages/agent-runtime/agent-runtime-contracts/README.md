# `@workbench/agent-runtime-contracts`

Workbench 拥有的、与具体 Agent Runtime 实现无关的数据 contracts。

## Public entries

- `@workbench/agent-runtime-contracts`
- `@workbench/agent-runtime-contracts/commands`
- `@workbench/agent-runtime-contracts/conversation`
- `@workbench/agent-runtime-contracts/descriptor`
- `@workbench/agent-runtime-contracts/message-metadata`
- `@workbench/agent-runtime-contracts/settings`

本包只依赖 Workbench 的基础 contracts，不得依赖 React、Next.js、具体 UI 框架、Node 运行时 API、
Pi 或其他具体 Agent Runtime。Runtime 原生命令、wire DTO、发现与选择策略不属于本包。

Source layout: src owns this capability and its contracts; lib contains consumed internal helpers; tests live at the package root. Example consumer: `src/message-metadata.ts` imports `lib/metadata-values.ts`. Capability and helper code remains TS/TSX; existing build tooling retains its language.

The `./workspace-catalog` entry owns neutral workspace directory DTOs, events, and minimal create/attach/list/remove ports. `./runtime-capabilities` includes WorkspaceFileReader. These contracts never depend on a concrete server class or Pi protocol.
