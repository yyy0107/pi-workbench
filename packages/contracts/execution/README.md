# `@workbench/execution-contracts`

Workbench workflow execution 的 JSON-safe DTO、协议与运行来源 guard。

## Public entry

- `@workbench/execution-contracts`

本包保持运行时无依赖，不得依赖 React、Next.js、assistant-ui、Node 运行时 API、Pi 或其他具体 Agent Runtime。
兼容旧数据所需的 `schedule`、`event`、`triggerId` 与 `dedupeKey` 字段仍属于公开读取协议，迁移包位置时不改变其语义。
