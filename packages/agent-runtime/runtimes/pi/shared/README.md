# `@workbench/agent-runtime-pi-shared`

Pi Runtime 的 client/server 共用纯逻辑：Runtime 身份、命令投影、消息 reducer、模型能力与会话展示/
分页规则。

## Public entries

- `@workbench/agent-runtime-pi-shared/descriptor`
- `@workbench/agent-runtime-pi-shared/commands`
- `@workbench/agent-runtime-pi-shared/messages`
- `@workbench/agent-runtime-pi-shared/models`
- `@workbench/agent-runtime-pi-shared/sessions`

本包没有根入口，不拥有网络、文件系统、凭据、Pi coding-agent runtime 对象、React 或浏览器 UI
状态。它只把 Pi protocol 投影为可在 Runtime 两端复用的确定性逻辑。
