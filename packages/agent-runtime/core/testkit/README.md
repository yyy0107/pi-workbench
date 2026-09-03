# `@workbench/agent-runtime-testkit`

Workbench Agent Runtime 的跨实现契约测试与最小 fixture。这个包只服务开发、测试和 adapter
认证，不属于浏览器或服务端生产运行时。

## Public entries

- `@workbench/agent-runtime-testkit/client`：浏览器 adapter 契约、通用 Host 契约和非 Pi fixture
- `@workbench/agent-runtime-testkit/server`：服务端 adapter 契约、稳定错误契约和非 Pi fixture
- `@workbench/agent-runtime-testkit/runtime`：无 React、无 Pi 的 Fake Runtime 与 Fake Session

测试套件只验证 Workbench 拥有的通用边界。Pi 或其他实现的 SDK、wire protocol、消息投影和
传输细节仍由各自 adapter 包测试。生产包不得依赖本包；具体实现只能把它作为开发依赖，避免
`client/server -> testkit -> client/server` 的生产依赖环。

本包不提供根入口，调用方必须明确选择 `client`、`runtime` 或 `server` 契约。
