# Workbench Pi Runtime

Workbench Pi Runtime 将 `@earendil-works/pi-coding-agent` 直接嵌入 Workbench 的 Next.js
进程。浏览器不连接独立的 Pi 服务；自定义 Node HTTP server 同时承载 Next.js、HTTP RPC
和两条 WebSocket 下行流，并负责 Pi session 的创建、恢复、执行和持久化。

本目录实现的是
[DeepSeek Harness HTTP / WebSocket 接口参考](../../docs/deepseekharness-api-design.md)中的当前
Workbench 子集，而不是参考文档全部 59 个接口。线协议的类型来源是：

- [`rpc-contracts.ts`](./rpc-contracts.ts)：RPC envelope，以及 Host、Workspace、LLM、Settings、
  Session 的请求和响应类型；
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
  ROUTER --> SETTINGS["AgentSettingsService"]
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
  `host.createDirectory`、`host.openPath`，以及本地应用集成
  `host.localApps.list`、`host.localApps.refresh`、`host.localApps.open`；
- Workspace：`workspace.list`、`workspace.listArchivedSessions`、`workspace.create`、`workspace.rename`、
  `workspace.delete`、`workspace.insertBefore`、`workspace.insertSessionBefore`、
  `workspace.setPinned`、`workspace.setSessionPinned`、`workspace.archiveSession`、
  `workspace.unarchiveSession`；
- Workspace files：`workspace.files.list`、`workspace.files.describe`、`workspace.files.read`、
  `workspace.files.write`，以及 `GET/HEAD /api/workspace.files.content`；
- Skills：`skill.list`；
- Commands：`command.list`；
- Extensions：`extension.list`；
- Settings：`settings.describe`、`settings.openDocument`、`settings.update`，以及附件识别配置
  `imageUnderstanding.describe`、`imageUnderstanding.update`；
- LLM：`llm.providers`、`llm.providerConfig`、`llm.startProviderLogin`、
  `llm.providerLogin`、`llm.respondProviderLogin`、`llm.cancelProviderLogin`、`llm.configureProvider`、
  `llm.removeProvider`、`llm.modelContextWindow`、`llm.updateModelContextWindow`、
  `llm.models`、`llm.discoverModels`；
- Session：`session.list`、`session.search`、`session.create`、`session.history`、
  `session.models`、`session.selectModel`、`session.rename`、`session.fork`、
  `session.delete`、`session.prompt`、`session.attachment`、`session.updateQueue`、
  `session.cancel`。

另外还提供：

- `POST /api/respond`：回答 mux 流中的 question 或 approval；
- `GET|HEAD /api/session.export`：流式导出一个 session，可选包含 descendants；
- `GET /api/events.mux`：session 事件、队列、交互请求等增量；
- `GET /api/events.host`：session、workspace、running 和 host 错误等增量。

参考文档中的 Agent Presets、Goals、Credentials 和 Message Feedback 等接口
尚未在本目录实现。

`host.describe` 同时返回稳定的 `product: "pi-workbench"`、Workbench 的 `version` 和当前嵌入
Pi coding agent 的 `piVersion`；原生壳使用 `product` 识别服务，状态栏等客户端界面应使用
`piVersion` 展示 Pi 版本。

当前 Settings 协议只暴露全局 `pi.agent` 命名空间，并且仅允许 loopback 请求。系统提示词写入
Pi agent 目录下的 `SYSTEM.md`；上下文压缩参数写入同目录的 `settings.json`，且会保留文件中的
其他 Pi 配置。更新使用 revision 进行冲突检测，并在新 session 或已有 session 执行 `/reload`
后生效。`settings.openDocument` 会在文件不存在时创建最小的 `settings.json`，再交给本地主机的
默认应用打开。

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
- `host.pickDirectory`、`host.openPath`、所有 `host.localApps.*` 方法和 `llm.discoverModels`
  即使来自配置的 trusted host，仍只允许 loopback 调用。

`PI_WORKBENCH_TRUSTED_HOSTS` 是逗号分隔的规范 `host` 或 `host:port`。不带端口的条目匹配该
host 的任意端口；带端口的条目精确匹配。

这只是本地服务的可达性和浏览器来源约束，不是身份认证。服务本身不提供 TLS、登录、
Cookie session 或 Bearer Token；如需跨机器暴露，必须在外层增加可信的认证与 TLS 代理。

## Workspace 和 Host 目录

`WorkspaceStore` 维护 canonical path、显示名称、workspace 顺序、每个 workspace 的 session
顺序、archived session 集合，以及 workspace/session 的置顶状态。新 workspace 使用持久随机 UUID；不要使用 legacy
`PiWorkspaceSummary` 的 cwd hash 推导新 `workspaceId`。

对外返回的 `WorkspaceView.sessionIds` 只包含当前未归档的 session；底层仍保留完整顺序，取消归档
后会恢复到原位置。`workspace.list` 只返回可见工作区快照，归档集合的权威基线由独立的
`workspace.listArchivedSessions` 返回。归档与取消归档 RPC 只确认本次 `sessionId` 和目标
`archived` 状态；持久化成功后的权威增量由 `events.host` 的
`host/session-archive-changed` 发布，并携带所属工作区更新后的可见快照。历史归档记录若尚未
归属 canonical Workspace，取消归档会先按 session 的 canonical cwd 恢复工作区成员关系，再以同一个
host 增量原子发布，避免恢复后的会话成为无工作区列表项。

状态默认写入 `~/.pi/workbench/workspaces.json`，置顶状态因此由服务端持久化并同步到连接同一
Workbench host 的多个浏览器。写入使用进程间锁和原子替换；启动和
`workspace.list` 会与 Pi 已持久化的 session 对账。Archive 只影响 Workbench 组织状态，
不会删除 Pi session JSONL。

原生目录选择器仅供 loopback 使用。没有桌面选择器或通过 trusted host 访问时，客户端可以用
`host.listDirectory` 与 `host.createDirectory` 完成远程目录选择。目录列表只返回可进入的目录，
单次最多 500 项，并通过 `truncated` 表示截断。

本地应用集成运行在 Electron 启动的本机 Host 进程中，不在 Renderer 中读取平台或安装路径。
统一 Registry 定义编辑器、终端和文件管理器；Windows Detector 使用 App Paths、Uninstall Registry、
已知目录、PATH 与 JetBrains Toolbox，macOS 使用 Bundle ID/Spotlight 与应用目录回退，Linux 使用
XDG application 目录、本地化用户桌面中的 `.desktop`、PATH 与 Flatpak。探测结果缓存在内存中，
只有 `host.localApps.refresh` 会主动重扫。
RPC 只返回稳定的 `id`、`name`、`kind` 和 `icon`，可执行文件、Bundle ID、desktop entry 与启动参数
始终留在 Host 内；品牌图标固定维护在 `extensions/builtin/workspace-file/icons`，不从操作系统动态提取。
所有启动均通过参数数组执行且禁用 shell，避免把用户路径拼进命令字符串。

资源管理器使用独立的 workspace-bound 文件接口，不复用目录选择器协议。请求携带
`workspaceId` 和规范的 `/` 分隔相对路径；服务端从 `WorkspaceStore` 读取权威根目录，同时执行
词法与 `realpath` 边界检查，拒绝 `..`、绝对路径和逃逸工作区的软链接。目录按需列出直接子项，
目录优先且单次最多 2,000 项。`workspace.files.describe` 只读取元数据和最多 64 KiB 的编码样本，
用于在不加载完整文件的前提下区分 UTF-8 文本与二进制文件。可编辑文本缓冲的读取和写入仍仅支持
最大 5 MiB 的 UTF-8 普通文件；写入必须携带读取时的 SHA-256 version，磁盘内容已变化时返回冲突，
避免静默覆盖。大文本源码与图片、PDF、音视频和 Office 文档通过同源
`workspace.files.content` 端点按需流式读取；前端对大文本做增量 UTF-8 解码和可见行虚拟化，避免先
缓冲完整 JSON 或挂载完整 textarea。内容端点支持 `HEAD`、单段 `Range`、ETag 和最大 100 MiB 的
预览边界，并复用相同的 workspace/realpath 授权规则，不向浏览器暴露主机文件路径。

## 模型

Pi `ModelRuntime` 是 provider、model 和凭证状态的权威来源：

- `llm.providers` 返回当前可配置或已注册的 provider，并刷新 Pi 的认证可用性快照，因此 Pi TUI
  在同一个 `auth.json` 中新增或移除的账号登录/API key 无需重启 Workbench 即可反映到设置页；
- `llm.providerConfig` 返回 provider 的非敏感连接参数和模型目录；
- `llm.providers` 同时返回 Pi provider 声明的可交互认证方式及其原始展示名称。账号登录通过
  `startProviderLogin` 启动后台认证会话，页面轮询 `providerLogin`，并用
  `respondProviderLogin` 回答 Pi 发出的 `text`、`secret`、`select` 或 `manual_code` prompt；
  `auth_url`、`device_code`、`info` 和 `progress` 事件直接驱动浏览器登录 UI。认证答案只用于
  当前 prompt，不进入状态快照、日志或 provider 配置，凭据仍由 Pi credential store 持久化；
- `llm.configureProvider` 将自定义连接与模型目录写入 Pi `models.json`，API key 则通过 Pi
  credential store 单独持久化；`llm.removeProvider` 移除由 Workbench 管理的内置 provider
  配置与凭据，对于自定义 provider 则删除其定义；
- `llm.models` 按 provider 分组返回可用模型和 reasoning efforts，单个 provider 失败不会使
  整个 catalog 失败；
- `llm.modelContextWindow` 读取单个模型的有效上下文窗口；`llm.updateModelContextWindow` 通过
  `models.json` 的 `modelOverrides` 只覆盖该模型的 `contextWindow`，并保留 provider 凭证、headers
  及其他模型配置。这个值只供 Pi 做 token 容量统计、溢出判断和自动压缩，不会作为 API 的
  `max_tokens` 发送；`maxTokens` 是独立的最大输出元数据，由 provider 适配器映射到对应的输出参数；
- `session.models` 在 catalog 之外还返回 session 当前选择和 `routable` 状态；
- `session.selectModel` 与 prompt/queue mutation 串行执行，避免与正在提交的图片 prompt
  发生竞态。

`llm.discoverModels` 可以读取 OpenAI-compatible `GET <baseURL>/models`，也可以使用
Anthropic `GET <baseURL>/v1/models`（当 base URL 已以 `/v1` 结尾时不会重复追加）及其游标分页。
显式传入的 `apiKey` 优先，否则已确定 provider 时会尝试 Pi 中已保存的凭证；请求级 key 不会
持久化、回传或写入日志。一次发现的全部模型列表响应合计最多读取 4 MiB，并支持请求取消。

Project-local settings、extensions 和 resources 默认不可信。只有
`PI_WORKBENCH_TRUST_PROJECT=1` 时，session 和模型服务才允许 Pi 加载这些项目资源。

## Skills

`skill.list` 按 `sessionId` 返回该 Pi session 的 `ResourceLoader` 已加载技能。响应只暴露协议定义的
名称、描述和模型是否可调用，不向浏览器返回技能文件路径。带有
`disable-model-invocation: true` 的技能会返回 `modelInvocable: false`，但仍可通过显式 skill 命令
调用。

技能发现沿用 Pi 的全局、package、settings 和项目资源规则。项目级技能仍受
`PI_WORKBENCH_TRUST_PROJECT=1` 控制；未信任时不会因为打开设置页而绕过资源信任边界。

## Commands

`command.list` 按 `sessionId` 返回统一的 Composer command catalog。每项带有可用于分组的
`kind`，当前聚合 Workbench 已适配的 Pi 内置命令、`extensionRunner.getRegisteredCommands()`、
prompt templates，以及 `ResourceLoader` 已加载的 skills。扩展项同时包含注册时的 `name` 和解决
重名后的 `invocationName`；只有 `invocationName` 能保证作为 `/command` 输入时准确命中目标命令。

扩展项还包含 description 和脱敏后的来源标签、scope、origin，不会把 handler、参数补全函数或
扩展文件绝对路径返回浏览器。catalog 也返回命令的 `effect` 和 `exclusive`：`/compact`、`/reload`
是独占的 `session-action`，普通 extension command 是独占的 `agent-turn`，prompt template 是
`prompt-transform`，skill 是可组合的 `instruction`。独占命令不能和另一个 Token 混用，从而避免
reload 后 preflight 快照失效，也避免 lifecycle action 与主 Agent turn 的顺序歧义。

Workbench 已适配的带参命令还可由 catalog 返回声明式 `argsSchema` 和 `argsBinding`。`/compact`
使用独占的 message-text binding：选择后在 Composer 上方打开结构化参数面板，参数写入
`args.customInstructions`；Token 后输入的正文始终保留在 `request.userText`。关闭面板会保留 Token，
点击 Token 可重新编辑，删除 Token 才清理参数。服务端先调用
`AgentSession.compact(customInstructions)`，成功后才执行可选的普通 Agent turn；压缩失败时显示错误并
停止后续请求。旧客户端发送的字符串 args 或无 args 的正文 fallback 仍兼容，对象不会整体 JSON
序列化后传给 Pi。

结构化 Composer 提交先对 catalog 中的全部 Token 做 preflight resolve；未知、冲突或已失效的命令会
在任何副作用发生前拒绝。执行阶段不再把所有命令统一实现成“先调用一次模型，再收集回答”：skill
通过 Pi 已加载资源公开的 `filePath`/`baseDir` 确定性读取为 trusted instruction，prompt template 按
Pi 公开的参数替换语义确定性转换 user text，两者都只进入一次最终主模型调用。extension command
仍通过 `AgentSession.prompt()` 的公开命令入口执行，但明确作为拥有该 turn 的 `agent-turn`，完成后
不会再启动第二个主请求。`/compact` 和 `/reload` 分别使用 `AgentSession.compact()` 与
`AgentSession.reload()`；Workbench 不调用或复制 extension handler，Pi 包源码和 `registerCommand()`
契约保持不变。

服务端先形成 canonical `ResolvedAgentRequest`，分别保存 user text、request config、trusted
instructions、trusted/untrusted context 和仅供历史/诊断使用的 command trace。trace 不会整体注入
模型；Pi string adapter 只在最后边界把 config、instructions、按 trust 标记的 context 和 user request
编译给 `AgentSession.prompt()`。这仍是 Pi 只接受字符串 prompt 时的 adapter fallback，而不是内部
canonical request。

UI 原文和 canonical Composer document 以隐藏的 `workbench.composer-user.v2` custom message
持久化；`sourceText` 只作为编辑器 serialization/fallback。解析状态和 command trace 另存为
`workbench.composer-resolution.v1`，历史投影恢复为一条标准 user message，并让用户气泡继续按与
Composer 相同的 Token renderer 显示。旧 `workbench.composer-user.v1` marker 仍可读取。纯
session-action 或 agent-turn 完成后不会额外启动空 LLM turn；空 `content` 只要带有结构化 Composer
语义仍可进入 admission。单个执行失败记录为 `execution-failed` trace，不回滚已接纳的用户消息；
纯命令事务发布 `command_done` 或 `command_error`。这类预期的命令结果不会发布全局
`host/agent-error`，该通道只保留给 session host、journal 和 transport 等基础设施故障。

Pi 内置 session-action 还会在用户 Token 气泡后运行可见的
`workbench.composer-command-response.v1` 状态机：调用 Pi API 前发布 `running`，完成后原位更新为
`success` 或 `execution-failed`。canonical message event 会实时传输并持久化每次状态转换，终态另外写入
不参与 LLM context 的 Session custom entry；响应只保存稳定的 command id、label、status 和 submission
id，不保存内部异常文本，UI 再按当前 locale 渲染。因此 `/compact` 会先显示“正在压缩上下文…”，再
更新为“会话上下文已压缩”或可见错误；`/reload` 使用同一生命周期。命令状态活跃时，同一次 Pi
compaction conversation event 不再额外渲染 separator，避免一个动作出现两条结果消息；历史恢复也按
`submissionId + commandId` 折叠为一个最终系统响应。

Pi TUI 中仅对终端有意义的命令（例如 `/quit`、`/copy`）不会出现在 Workbench catalog；只有具备
Workbench 等价语义的内置命令才会被暴露，避免把 UI action 错当成普通 prompt。Pi 包源码与
`registerCommand()` 契约保持不变。

## Extensions

`extension.list` 按 `sessionId` 返回该 Pi session 的 `ResourceLoader` 已成功加载且未标记为 hidden
的扩展。响应包含面向展示的扩展名称、来源范围、来源类型，以及其注册的事件、工具和命令名称；
不会把扩展文件的绝对路径或具体加载错误内容返回浏览器，只返回加载失败数量。

扩展发现沿用 Pi 的全局、package、settings 和项目资源规则。项目级扩展受
`PI_WORKBENCH_TRUST_PROJECT=1` 控制；查询设置页不会提升项目资源信任。

## Session 生命周期和持久状态

Pi `SessionManager` 管理 JSONL session。进程内的 session registry 为正在使用的 session
创建 `HostedPiSession`，并允许多个 session 独立后台运行。空闲且没有暂停队列的 host 在
10 分钟后释放；JSONL 历史不会因此丢失，下一次访问会 cold-open。

Workbench 在 Pi JSONL 中保存 canonical event journal。每个 `SessionEvent` 都包含稳定递增的
`seq`、epoch-millisecond `time` 和原始 `data`，因此 cold history 和 live mux 使用同一事件
序列。`session.history` 按完整消息组分页，避免把 `message_start` / `message_end` 组从中间切开。

token 级 `message_update` 是例外：它通过 `session/message-update` 作为无 durable `seq` 的
transient compact delta 实时发送，不写 JSONL、不进入 canonical event cache，也不推进 reconnect
watermark。delta 复用 `@earendil-works/pi-ai` 的 `PiMessagesEvent` 内容事件子集，并由固定的
`streamId`、`message_start` durable `startSeq` 和 stream 内 revision 定序；payload 只重复不含
`content` 的固定大小 message metadata。`message_start` 后会先保留 revision 0 的空基线，因此在首个
token 到达前连接的客户端也能建立正确 stream。最终 durable `message_end` 仍是完成态的权威校正，首 token
时间也只在 `message_end.data.workbenchTiming` 中持久化一次。旧 JSONL 中已经存在的 durable
`message_update` 仍按原序列读取，以保持历史和 fork 坐标兼容。

其他关键行为：

- `session.create` 支持调用方指定 session ID，并对同一 ID 串行化以保证幂等和 cwd 冲突检测；
- 未提供 workspace/cwd 时，session 使用服务进程的 `process.cwd()`；
- prompt、queue mutation 和 model selection 在每个 session 内串行化；
- follow-up/steer 先以 prompt `rpcId` 乐观加入客户端队列；服务端接纳后沿用该 ID，
  `session.prompt` 响应通过 `queued` 和可选 `queueItemId` 区分进入队列或直接成为下一轮，失败则按 ID
  精确回滚；
- queue item 有稳定 ID，可执行 edit、remove、follow-up 重排或将 follow-up 提升为 steer；
- prompt 的 `rpcId` 和规范化 IANA client timezone 会作为 provenance 写入 JSONL；
- inline 图片和 PDF 会在进入 session 前校验 base64、文件签名、媒体类型及大小；附件路由会在
  文本模型运行前决定原生视觉或 OCR 预处理；
- fork 只在可证明已持久化的完整 turn boundary 建立独立 child，不替换或修改 source session；
- create、rename、fork、cold rename、running 状态、归档状态和 workspace 变更都会发布对应实时增量；
- export 直接流式打包原始 JSONL，不先把整个 ZIP 或 session 读入内存。

## mux 和 host WebSocket

两条 WebSocket 都是 server-to-client downlink。每个 text frame 都是完整的
`ServerRequest`，且 `method === payload.type`。客户端不得在 socket 上发送应用消息；服务收到
任意客户端 message 后以 close code `1008`、reason `downlink only` 关闭连接。question 和
approval 的上行回答必须通过 `POST /api/respond`。

`/api/events.mux` 当前承载：

- canonical session event 和 session watermark；
- 不参与 journal、durable sequence 或 reconnect watermark 的 transient `session/message-update`；
- 仅在连接 bootstrap 或 compact projector 自修复时出现的 `session/message-snapshot`；
- `session.prompt` 真正接纳后的瞬时 `session/prompt-accepted` 确认；其 frame `rpcId` 与原 HTTP
  RPC 相同，并携带接纳后的运行态，但不重复传输 prompt 内容；
- 权威 queue snapshot；
- question/approval requested 与 resolved；
- stream error；
- contracts 还保留 jobs 和 projection payload，以便后续 producer 接入。

`/api/events.host` 当前承载带完整摘要的 session added/changed、session removed/status、agent
error、workspace changed/removed/order、archived session 变化和兼容的 remote event。连接中的浏览器
可以直接应用会话创建、标题/消息元数据、运行与归档增量；`session.list` 只负责首屏和断线重建基线。

每个 active assistant stream 在 Hub 中只保留一份物化快照。Hub 在订阅调用栈内同步捕获 snapshot
cut，随后按 `session/subscribed → session/message-snapshot → queue/interaction → cut 后 live delta`
发送；客户端丢弃不高于 snapshot revision 的重复 delta，revision 缺口则废弃本代连接并通过新
snapshot 恢复。snapshot 还携带尚未完成的 tool-call 原始 JSON buffer，因为已经解析的 arguments
不能继续拼接后续 JSON fragment。durable `message_end`、branch reset 和 host shutdown 会清除该
快照，避免重连复活已完成的 streaming row。bootstrap 缓冲上限为 10,000 帧；单 socket 待发送
数据上限为 1 MiB。
消费者过慢、序列化失败或 stream 异常时，服务尽力发送 `stream/error`，然后以 `1011` 结束
连接。普通 `GET|HEAD` 访问这两个路径而不 upgrade 会得到 `426 Upgrade Required`。

浏览器把 mux 和 host 作为同一个 connection generation：只有两条 socket 都打开后才提交该代
frame；任意一条断开都会废弃整代并同时重建两条连接。重连使用带抖动的指数退避（250 ms 到
10 s），随后通过 `host.describe`、`session.list`、`workspace.list` 和
`workspace.listArchivedSessions` 恢复权威基线，旧一代的未决交互不会覆盖新状态。

开发模式会在浏览器 Console 输出 `websocket connecting`、两条 `stream open` 和最终的
`websocket ready`；Network 面板中 mux/host 应同时保持 `101 Switching Protocols`。若普通
`GET /api/events.mux` 返回 `405` 而不是 `426`，通常说明端口仍被直接启动的旧 `next dev`
占用，应先精确确认监听进程，再用 `pnpm dev` 重新启动 custom server。

## 自定义 server

根目录 [`server.ts`](../../server.ts) 是开发和生产的必经入口：

1. 创建一个不监听网络的 Node server，让 Next 安装自己的 upgrade listener；
2. `app.prepare()` 后取得 Next request handler；
3. 创建 Pi 下行流和独立双向 Terminal 的 `ws` `noServer` gateway；
4. 启动唯一对外监听的 Workbench HTTP server；
5. 将 Terminal 及 mux/host upgrade 交给对应 gateway，其余 upgrade 转发给 Next。

Terminal 的 PTY 生命周期和双向 frame 协议属于独立的
[`runtime/terminal`](../terminal/README.md) 边界，不混入 Pi 的 downlink-only stream。

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
    ├── commands/
    │   └── command-service.ts
    ├── extensions/
    │   └── extension-service.ts
    ├── skills/
    │   └── skill-service.ts
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

## OCR 适配器规范

OCR 设置中的源码是以下形式的有效 TypeScript，但运行时不会把它交给 TypeScript/JavaScript 引擎：

```ts
export default defineOcrAdapter({
  version: 1,
  id: "example-ocr",
  label: "Example OCR",
  accepts: ["image"],
  authentication: { header: "Authorization", prefix: "Bearer " },
  request: {
    kind: "json",
    body: { model: "$model", file: "$attachment.dataUrl" },
  },
  operation: {
    kind: "sync",
    output: {
      strategy: "first-non-empty",
      rules: [{ path: "result.text", format: "text" }],
    },
  },
});
```

服务端提取中间的 JSON 数据，安全移除字符串外的 `//` 与块注释，再执行字段白名单、长度/深度/数组
上限、标识符、HTTP header、路径语法和版本校验，最后交给统一执行器。源码可以包含说明性注释，但
不能包含 import、函数、表达式或 wrapper 外的语句；因此它不是 Node `vm` 沙箱，也不会获得
`process`、文件系统、环境变量或原始凭据。

版本 1 的顶层字段如下：

- `id` / `label`：稳定 Provider ID 和展示标签；
- `accepts`：`image`、`pdf` 或两者；
- `authentication`：写入凭据的 header 和 prefix。凭据仍由服务端独立的 mode-0600 settings
  document 保存，不出现在源码或 describe RPC；
- `request`：`json` body 模板或 `multipart` 文件字段/普通字段。模板值支持 `$model`、
  `$attachment.dataUrl`、`$attachment.base64`、`$attachment.name` 和
  `$attachment.mimeType`；
- `api`：可选的服务码路径、成功值及到稳定 Workbench 错误码的映射；
- `operation`：`sync` 直接按 output rules 取文本，或 `async-job` 声明 job ID、poll path、状态值、
  JSONL/纯文本结果源和 output rules；
- `retry`：仅对映射中显式标记 `retryable` 的提交错误做有界指数退避。

output rule 使用受限 dot path，并以 `[]` 展平数组，例如
`result.layoutParsingResults[].markdown.text` 或
`result.ocrResults[].prunedResult.rec_texts[]`。多个 rule 按顺序执行，第一个非空结果获胜；JSONL
逐行解析后再合并。所有 HTTP 请求仍受超时、取消、响应大小、HTTPS、重定向和结果下载 SSRF 防护。
新增厂商或模型应优先新增/调整模板，不应在 session coordinator 中增加厂商分支。

## 当前能力边界

- `session.attachment` 已保留协议形状，但 Pi 当前没有按 `attachmentId` 读取持久附件的仓库；
  该方法稳定返回 `attachment-error`。发送 prompt 时的 inline 图片与 PDF 已支持。
- Inline 附件最多 20 个。图片仅接受 PNG、JPEG、WebP 和 GIF，单张解码后最多 10 MiB；PDF
  仅接受 `application/pdf`，单文件最多 50 MiB；混合附件解码后总计最多 50 MiB。媒体类型必须与
  文件签名一致。
- 附件预处理使用 `workbench.attachment-recognition.v1` 状态机，并以
  `workbench.attachment-recognition` data part 合并到 AI 消息工作时间线；状态从 pending、running
  进入 succeeded/failed/cancelled/skipped 终态，成功结果可展开。历史
  `workbench.image-recognition.v1` 事件仍可读取，但新事件不再使用图片专属字段名。
- 图片与 PDF 使用种类内独立、从 1 开始的稳定引用（`image-1`、`image-2`、`pdf-1` 等）。同一引用
  同时用于展开结果和隔离的模型上下文，因此用户说“图一 / 图二”时不会依赖 Provider 返回顺序；
  旧历史中的通用附件 ID 会按结果顺序回退显示为“附件 N”。
- OCR 通过版本化的声明式 TypeScript 适配器执行。设置页内置 GLM-OCR、PaddleOCR-VL-1.6、
  PP-OCRv6 和 PP-StructureV3 模板，也允许编辑自定义适配器。适配器声明鉴权头、JSON/Multipart
  请求、同步/异步作业、错误码、轮询状态、结果 URL 和文本提取路径；服务端只把源码解析为受限
  数据，不执行 import、函数或任意 JavaScript。多模态预处理仍使用固定的 Pi ModelRuntime 实现。
- 内置 OCR 适配器接收图片与 PDF。PDF 不会作为 Pi 原生模型内容发送，也不会走当前仅支持图片的
  多模态预处理；只要请求包含 PDF，路由就要求已配置且声明支持 PDF 的 OCR 适配器。识别文本以
  隔离的 `workbench-untrusted-context` 注入文本模型，原始 Provider 响应、凭据与附件字节不会进入
  状态消息。旧版 GLM/Paddle 配置在读取时映射为对应适配器，原凭据保持 write-only 且不会被覆盖。
- 当前 queue edit 只接受 text content；附件 queue item 可以保留、删除或 steer，但不能通过该
  RPC 改写为新的附件内容。
- Skills 当前只实现 session-scoped `skill.list`；启停、编辑、安装和 reload 尚未加入 Workbench
  协议。
- Extensions 当前只实现 session-scoped `extension.list`；启停、编辑、安装和 reload 尚未加入
  Workbench 协议。
- Commands 已聚合受支持的 Pi built-ins、session-scoped extension commands、prompt templates 和
  skills。终端专用的 interactive TUI commands 仍不会暴露；新增内置项时必须先提供 Workbench
  等价语义，并继续使用 Pi 的公开 API。
- `session.create.agentPreset` 是兼容字段，当前 Pi session engine 不支持创建时选择 preset，传入
  后返回 `agent-preset-invalid`。
- 历史图片在 text-only 模型上下文中会被稳定占位文本替换，不会阻止后续纯文字消息；仍不能在活动
  图片 prompt 或待处理图片队列存在时切换到 text-only model。
- `/api/pi/**`、`legacy-sse.ts` 和 legacy contracts 仍为兼容层；新 UI 的核心读写使用
  `/api/<method>` 与 mux/host WS。队列 pause 与 follow-up 重排暂时仍经过 legacy command，因为目标
  协议没有对应方法。
- 当前实现不等同于参考 Harness 的完整 Host；新增接口时应先扩展 contracts、RPC validation、
  domain service 和测试，再接入 UI，不能直接在组件中发明第二套协议。
