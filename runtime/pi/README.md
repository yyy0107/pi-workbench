# Workbench Pi Runtime

Workbench Pi Runtime 将 `@earendil-works/pi-coding-agent` 直接嵌入 Workbench 的 Next.js
进程。浏览器不连接独立的 Pi 服务；自定义 Node HTTP server 同时承载 Next.js、HTTP RPC
和两条 WebSocket 下行流，并负责 Pi session 的创建、恢复、执行和持久化。

本目录实现的是
[DeepSeek Harness HTTP / WebSocket 接口参考](../../docs/deepseekharness-api-design.md)中的当前
Workbench 子集，而不是参考文档全部 59 个接口。线协议的类型来源是：

- [`rpc-contracts.ts`](./rpc-contracts.ts)：RPC envelope，以及 Host、Workspace、LLM、Session
  的请求和响应类型；
- [`stream-contracts.ts`](./stream-contracts.ts)：mux/host WebSocket frame 和 payload 联合；
- [`contracts.ts`](./contracts.ts)：Workbench UI 适配层与 legacy `/api/pi/**` 使用的 Pi 类型。

## 架构

```mermaid
flowchart TD
  UI["Browser / assistant-ui"] --> CM["PiSessionManager / PiClientSession"]
  CM -->|"POST /api/<method>"| HTTP["Unary RPC"]
  CM -->|"events.mux + events.host"| WS["Paired WebSocket generation"]

  HTTP --> CS["Custom Workbench HTTP server"]
  WS --> CS
  CS --> ROUTER["RPC router / WebSocket gateway"]

  ROUTER --> WORKSPACE["WorkspaceStore"]
  ROUTER --> MODEL["ModelService"]
  ROUTER --> SESSION["SessionRpcService"]
  ROUTER --> HUB["StreamHub"]

  SESSION --> REGISTRY["Session registry / HostedPiSession"]
  REGISTRY --> PI["Pi AgentSession + SessionManager"]
  PI --> JSONL["Persistent session JSONL"]
  REGISTRY --> HUB
  WORKSPACE --> HUB
```

Unary RPC 是 session、workspace 和 running 状态的权威快照；WebSocket 只传递增量事件。
客户端重连后若服务端 watermark 与本地序号不同，会重新读取 unary 状态，而不是假设流能够永久
保存全部历史。

## 已实现的协议面

所有普通 unary 方法都使用 `POST /api/<method>`：

- Host：`host.describe`、`host.pickDirectory`、`host.listDirectory`、
  `host.createDirectory`、`host.openPath`；
- Workspace：`workspace.list`、`workspace.create`、`workspace.rename`、
  `workspace.delete`、`workspace.insertBefore`、`workspace.insertSessionBefore`、
  `workspace.archiveSession`；
- LLM：`llm.providers`、`llm.models`、`llm.discoverModels`；
- Session：`session.list`、`session.search`、`session.create`、`session.history`、
  `session.models`、`session.selectModel`、`session.rename`、`session.fork`、
  `session.prompt`、`session.attachment`、`session.updateQueue`、`session.cancel`。

另外还提供：

- `POST /api/respond`：回答 mux 流中的 question 或 approval；
- `GET|HEAD /api/session.export`：流式导出一个 session，可选包含 descendants；
- `GET /api/events.mux`：session 事件、队列、交互请求等增量；
- `GET /api/events.host`：session、workspace、running 和 host 错误等增量。

参考文档中的 Skills、Agent Presets、Goals、Settings、Credentials、Commands 和 Message
Feedback 等接口尚未在本目录实现。

## RPC envelope 和错误

普通请求必须使用下面的 envelope，`method` 必须与 URL 中的方法完全一致：

```json
{
  "type": "client-request",
  "rpcId": "session-list-1",
  "method": "session.list",
  "payload": {}
}
```

响应回显同一个 `rpcId`：

```json
{
  "type": "server-response",
  "rpcId": "session-list-1",
  "result": {
    "ok": true,
    "value": {}
  }
}
```

HTTP `200` 只表示 RPC 载体成功完成。调用方必须继续检查 `result.ok`；输入校验和业务失败
同样返回 HTTP `200`，失败内容统一为：

```json
{
  "ok": false,
  "error": {
    "code": "bad-request",
    "message": "Invalid RPC request",
    "details": { "issues": [] }
  }
}
```

客户端应使用 `error.code` 和 `error.details` 分支，不应依赖面向人的 `message`。RPC object
会接受并剥离未知字段，以保持参考协议的兼容行为。

载体层规则：

- 只接受 `POST` 和 `Content-Type: application/json`；
- 默认最多缓冲 160 MiB 请求体，声明或实际超限返回 `413`；
- 非 JSON、非法 UTF-8 或非法 JSON 返回 `400`；
- 非 JSON media type 返回 `415`；
- 信任检查失败返回 `403`；
- 未预期的 handler 错误返回纯文本 `500`，不会把内部异常写入 RPC details。

`POST /api/respond` 使用 `ClientResponse`，并返回
`{ accepted: true } | { accepted: false, reason: "not-pending" | "bad-response" }`；它不是普通
`ServerResponse`。交互请求按 `rpcId` first-claim，重复或已失效的回答不会再次执行。

## 请求信任边界

Workbench 默认监听 `127.0.0.1:3000`。所有 `/api` HTTP 请求和两条 WebSocket upgrade
都执行相同的 DNS-rebinding / cross-site 防护：

- `Host` 必须是 loopback authority，或匹配 `PI_WORKBENCH_TRUSTED_HOSTS`；
- `Origin` 存在时，其 authority 必须与 `Host` 完全一致；
- `Sec-Fetch-Site: cross-site` 一律拒绝；
- `host.pickDirectory`、`host.openPath` 和 `llm.discoverModels` 即使来自配置的 trusted host，
  仍只允许 loopback 调用。

`PI_WORKBENCH_TRUSTED_HOSTS` 是逗号分隔的规范 `host` 或 `host:port`。不带端口的条目匹配该
host 的任意端口；带端口的条目精确匹配。

这只是本地服务的可达性和浏览器来源约束，不是身份认证。服务本身不提供 TLS、登录、
Cookie session 或 Bearer Token；如需跨机器暴露，必须在外层增加可信的认证与 TLS 代理。

## Workspace 和 Host 目录

`WorkspaceStore` 维护 canonical path、显示名称、workspace 顺序、每个 workspace 的 session
顺序和 archived session 集合。新 workspace 使用持久随机 UUID；不要使用 legacy
`PiWorkspaceSummary` 的 cwd hash 推导新 `workspaceId`。

状态默认写入 `~/.pi/workbench/workspaces.json`。写入使用进程间锁和原子替换；启动和
`workspace.list` 会与 Pi 已持久化的 session 对账。Archive 只影响 Workbench 组织状态，
不会删除 Pi session JSONL。

原生目录选择器仅供 loopback 使用。没有桌面选择器或通过 trusted host 访问时，客户端可以用
`host.listDirectory` 与 `host.createDirectory` 完成远程目录选择。目录列表只返回可进入的目录，
单次最多 500 项，并通过 `truncated` 表示截断。

## 模型

Pi `ModelRuntime` 是 provider、model 和凭证状态的权威来源：

- `llm.providers` 返回当前可配置或已注册的 provider；
- `llm.models` 按 provider 分组返回可用模型和 reasoning efforts，单个 provider 失败不会使
  整个 catalog 失败；
- `session.models` 在 catalog 之外还返回 session 当前选择和 `routable` 状态；
- `session.selectModel` 与 prompt/queue mutation 串行执行，避免与正在提交的图片 prompt
  发生竞态。

`llm.discoverModels` 可以读取 OpenAI-compatible `GET <baseURL>/models`。显式传入的 `apiKey`
优先，否则已确定 provider 时会尝试 Pi 中已保存的凭证；请求级 key 不会持久化、回传或写入
日志。模型列表响应最多读取 4 MiB，并支持请求取消。

Project-local settings、extensions 和 resources 默认不可信。只有
`PI_WORKBENCH_TRUST_PROJECT=1` 时，session 和模型服务才允许 Pi 加载这些项目资源。

## Session 生命周期和持久状态

Pi `SessionManager` 管理 JSONL session。进程内的 session registry 为正在使用的 session
创建 `HostedPiSession`，并允许多个 session 独立后台运行。空闲且没有暂停队列的 host 在
10 分钟后释放；JSONL 历史不会因此丢失，下一次访问会 cold-open。

Workbench 在 Pi JSONL 中保存 canonical event journal。每个 `SessionEvent` 都包含稳定递增的
`seq`、epoch-millisecond `time` 和原始 `data`，因此 cold history 和 live mux 使用同一事件
序列。`session.history` 按完整消息组分页，避免把 `message_start` / `message_end` 组从中间切开。

其他关键行为：

- `session.create` 支持调用方指定 session ID，并对同一 ID 串行化以保证幂等和 cwd 冲突检测；
- 未提供 workspace/cwd 时，session 使用服务进程的 `process.cwd()`；
- prompt、queue mutation 和 model selection 在每个 session 内串行化；
- queue item 有稳定 ID，可执行 edit、remove 或将 follow-up 提升为 steer；
- prompt 的 `rpcId` 和规范化 IANA client timezone 会作为 provenance 写入 JSONL；
- inline image 会在进入 Pi 前校验 base64、文件签名、媒体类型和模型图片能力；
- fork 只在可证明已持久化的完整 turn boundary 建立独立 child，不替换或修改 source session；
- rename、fork、cold rename、running 状态和 workspace 变更都会发布对应实时增量；
- export 直接流式打包原始 JSONL，不先把整个 ZIP 或 session 读入内存。

## mux 和 host WebSocket

两条 WebSocket 都是 server-to-client downlink。每个 text frame 都是完整的
`ServerRequest`，且 `method === payload.type`。客户端不得在 socket 上发送应用消息；服务收到
任意客户端 message 后以 close code `1008`、reason `downlink only` 关闭连接。question 和
approval 的上行回答必须通过 `POST /api/respond`。

`/api/events.mux` 当前承载：

- canonical session event 和 session watermark；
- 权威 queue snapshot；
- question/approval requested 与 resolved；
- stream error；
- contracts 还保留 jobs 和 projection payload，以便后续 producer 接入。

`/api/events.host` 当前承载 session added/removed/status、agent error、workspace changed/removed/
order、archived session 变化和兼容的 remote event。

新 mux subscriber 会先收到已保留的 session watermark、queue 和未决交互，再收到 bootstrap
期间缓冲的 live frame。bootstrap 缓冲上限为 10,000 帧；单 socket 待发送数据上限为 1 MiB。
消费者过慢、序列化失败或 stream 异常时，服务尽力发送 `stream/error`，然后以 `1011` 结束
连接。普通 `GET|HEAD` 访问这两个路径而不 upgrade 会得到 `426 Upgrade Required`。

浏览器把 mux 和 host 作为同一个 connection generation：只有两条 socket 都打开后才提交该代
frame；任意一条断开都会废弃整代并同时重建两条连接。重连使用带抖动的指数退避（250 ms 到
10 s），随后通过 `host.describe`、`session.list` 和 `workspace.list` 恢复权威基线，旧一代的
未决交互不会覆盖新状态。

开发模式会在浏览器 Console 输出 `websocket connecting`、两条 `stream open` 和最终的
`websocket ready`；Network 面板中 mux/host 应同时保持 `101 Switching Protocols`。若普通
`GET /api/events.mux` 返回 `405` 而不是 `426`，通常说明端口仍被直接启动的旧 `next dev`
占用，应先精确确认监听进程，再用 `pnpm dev` 重新启动 custom server。

## 自定义 server

根目录 [`server.ts`](../../server.ts) 是开发和生产的必经入口：

1. 创建一个不监听网络的 Node server，让 Next 安装自己的 upgrade listener；
2. `app.prepare()` 后取得 Next request handler；
3. 创建 `ws` 的 `noServer` gateway；
4. 启动唯一对外监听的 Workbench HTTP server；
5. 将 mux/host upgrade 交给 Pi gateway，其余 upgrade 转发给 Next。

这样可以避免 Next 与 Pi 分别监听端口或抢占 upgrade。不要直接用 `next dev` 或 `next start`
启动本项目；`pnpm dev` 和 `pnpm start` 已经使用该入口。

## 目录布局

实现按传输层和业务域分组，测试与源文件共置：

```text
runtime/pi/
├── README.md
├── contracts.ts
├── rpc-contracts.ts
├── stream-contracts.ts
├── client/
│   ├── transport/
│   │   ├── api.ts
│   │   └── connections.ts
│   ├── runtime/
│   │   ├── manager.ts
│   │   └── context.tsx
│   ├── messages/
│   │   ├── messages.ts
│   │   └── queue.ts
│   ├── models/
│   │   └── model-selection.ts
│   └── sessions/
│       ├── session-create-intent.ts
│       └── session-rpc-adapter.ts
└── server/
    ├── core/
    │   └── errors.ts
    ├── transport/
    │   ├── api-request-guard.ts
    │   ├── custom-server.ts
    │   ├── local-api-request-trust.ts
    │   ├── responses.ts
    │   ├── rpc-router.ts
    │   └── rpc-transport.ts
    ├── host/
    │   ├── host-directories.ts
    │   └── native-workspace-picker.ts
    ├── models/
    │   └── model-service.ts
    ├── workspaces/
    │   ├── workspace-registry.ts
    │   ├── workspace-store.ts
    │   └── workspace-paths.ts
    ├── sessions/
    │   ├── interactive-response-registry.ts
    │   ├── session-event-journal.ts
    │   ├── session-export.ts
    │   ├── session-queue.ts
    │   ├── session-registry.ts
    │   └── session-rpc-service.ts
    └── streams/
        ├── legacy-sse.ts
        ├── stream-hub.ts
        └── websocket-gateway.ts
```

职责约定：

- `transport` 只处理 carrier、信任、校验、路由和 upgrade；
- `sessions`、`workspaces`、`models`、`host` 包含业务规则和 Pi/文件系统适配；
- `streams` 负责实时分发与 legacy SSE，不拥有业务状态；
- `client/transport` 不拥有 assistant-ui 状态，状态协调集中在 `client/runtime`；
- `*-contracts.ts` 不导入 server/client 实现，保持线协议可独立复用。

## 配置

- `PORT`：对外监听端口，默认为 `3000`，必须为 `1..65535` 的整数；
- `WORKBENCH_HOST`：对外监听 hostname，默认为 `127.0.0.1`；
- `PI_WORKBENCH_TRUSTED_HOSTS`：额外允许的逗号分隔 `host[:port]` authority，默认没有；
- `PI_WORKBENCH_TRUST_PROJECT`：只有精确值 `1` 才信任 project-local Pi 资源；
- `PI_WORKBENCH_STATE_DIR`：Workspace 状态目录，默认为 `~/.pi/workbench`；
- `PI_WORKBENCH_WORKSPACE_STATE_FILE`：Workspace 状态文件的显式路径，设置后优先于 state dir。

## 运行和验证

项目只使用 pnpm：

```bash
pnpm install
pnpm dev
```

生产构建和启动：

```bash
pnpm build
pnpm start
```

常用静态检查：

```bash
pnpm exec tsc --noEmit
pnpm lint
```

运行 Pi runtime 的 Node 测试：

```bash
mapfile -t pi_tests < <(rg --files runtime/pi -g '*.test.ts')
node --no-warnings=ExperimentalWarning \
  --import ./.codex/hooks/register-typescript-loader.mjs \
  --test "${pi_tests[@]}"
```

修改 custom server 或 WebSocket 时，除单元测试外还应在非 3000 端口进行 smoke test，至少验证
RPC envelope、恶意 Host 的 `403`、普通 stream GET 的 `426`、两个 WS handshake，以及向
downlink 发送消息后的 `1008` close。

## 当前能力边界

- `session.attachment` 已保留协议形状，但 Pi 当前没有按 `attachmentId` 读取持久附件的仓库；
  该方法稳定返回 `attachment-error`。发送 prompt 时的 inline image 已支持。
- Inline image 仅接受 PNG、JPEG、WebP 和 GIF；最多 20 张，单张解码后最多 20 MiB，总计最多
  100 MiB。媒体类型必须与文件签名一致。
- 当前 queue edit 只接受 text content；图片 queue item 可以保留、删除或 steer，但不能通过该
  RPC 改写为新的图片内容。
- `session.create.agentPreset` 是兼容字段，当前 Pi session engine 不支持创建时选择 preset，传入
  后返回 `agent-preset-invalid`。
- 不能把包含历史图片、活动图片 prompt 或待处理图片队列的 session 切换到 text-only model。
- `/api/pi/**`、`legacy-sse.ts` 和 legacy contracts 仍为兼容层；新 UI 的核心读写使用
  `/api/<method>` 与 mux/host WS。队列 pause 暂时仍经过 legacy command，因为目标协议没有
  pause 方法。
- 当前实现不等同于参考 Harness 的完整 Host；新增接口时应先扩展 contracts、RPC validation、
  domain service 和测试，再接入 UI，不能直接在组件中发明第二套协议。
