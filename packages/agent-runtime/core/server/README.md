# `@workbench/agent-runtime-server`

Workbench 拥有、由具体 Agent Runtime 在宿主服务端实现的通用端口与安装边界。

## Public entries

- `@workbench/agent-runtime-server`
- `@workbench/agent-runtime-server/tokens`
- `@workbench/agent-runtime-server/commands`
- `@workbench/agent-runtime-server/execution`
- `@workbench/agent-runtime-server/threads`
- `@workbench/agent-runtime-server/adapter`
- `@workbench/agent-runtime-server/installation`

`commands`、`execution` 与 `threads` 是 Workbench 的稳定 server port。执行端只强制实现
`submit`/`cancel`，线程端只强制实现 catalog 与 CRUD；regeneration、resume、branches、queue、search
和 fork 通过显式 optional subport 声明能力。

状态、分支、fork 点和 mutation token 是具体实现拥有的 opaque string。Workbench 只负责原样回传，
不会把 Pi 的 leaf、event revision、JSONL 或 SDK session 模型提升为共享协议。

本包不得依赖 React、Next.js、assistant-ui 或具体 Agent Runtime。Pi 等实现应在自己的 adapter package 中
实现这些端口，并在 wire/service 边界完成原生字段与稳定错误码的映射。
