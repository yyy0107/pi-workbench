# `@workbench/agent-runtime-contracts`

Workbench 拥有的、与具体 Agent Runtime 实现无关的 Runtime 身份和命令目录 contracts。

## Public entries

- `@workbench/agent-runtime-contracts`
- `@workbench/agent-runtime-contracts/descriptor`
- `@workbench/agent-runtime-contracts/commands`

本包只依赖 Workbench 的基础 contracts，不得依赖 React、Next.js、assistant-ui、Node 运行时 API、
Pi 或其他具体 Agent Runtime。Runtime 原生命令、wire DTO、发现与选择策略不属于本包。
