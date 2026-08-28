# Workbench Runtime

`runtime` 放置跨 UI 组件、协议传输与宿主服务的运行时适配。目录按运行环境、领域所有权和共享范围
划分，而不是按调用顺序划分：

```text
runtime/
├── README.md
├── assistant-ui/                    # 浏览器侧 assistant-ui Runtime 集成
│   ├── README.md
│   ├── adapters/
│   ├── agent-runtime-adapter.ts
│   ├── agent-runtime-installation.tsx
│   ├── agent-runtime-context.tsx
│   ├── agent-runtime-extras.ts
│   ├── agent-runtime-host.tsx
│   ├── testing/
│   ├── tool-events.ts
│   └── use-workbench-runtime.ts
├── server/                          # 后端无关的 Agent 宿主端口
│   ├── README.md
│   ├── agent-command-catalog-port.ts
│   ├── agent-execution-port.ts
│   ├── agent-thread-store-port.ts
│   ├── agent-runtime-installation.ts
│   ├── testing/
│   └── agent-runtime-adapter.ts
├── shared/                          # 跨 runtime、client/server 的纯领域逻辑
│   ├── agent-runtime/
│   │   └── descriptor.ts
│   ├── agent-command/
│   │   └── catalog.ts
│   ├── composer/
│   │   ├── request.ts
│   │   └── request.test.ts
│   └── attachment-understanding/
│       ├── ocr-adapter.ts
│       ├── paddleocr-models.ts
│       └── state-machine.ts
├── pi/                              # Pi Runtime
│   ├── client/
│   ├── contracts/
│   ├── shared/
│   └── server/
└── terminal/                        # 独立 Terminal Runtime
    ├── contracts.ts
    └── server/
```

## 边界

- `assistant-ui` 是后端无关的浏览器 Runtime 组合层；它可以依赖 assistant-ui 和顶层 `shared`，但
  不得导入 `pi`。具体 Agent Runtime 反向实现这里的 `WorkbenchAgentRuntimeAdapter`。
- `server` 是后端无关、仅在宿主进程使用的 Agent 端口层；它不得导入 `pi` 或其他具体 Runtime。
  当前抽象已验证的执行生命周期、线程目录/存储与 Composer 命令目录，不复制 Pi 的消息、history、
  canonical event 或传输协议。
- `pi/client/assistant-ui` 是当前唯一的 Agent Runtime 实现层，负责把 Pi session、队列、恢复、错误
  和 workspace 能力投影为 assistant-ui Runtime，并完整拥有 Pi manager 的浏览器侧安装与生命周期；
  Pi 的 HTTP/WebSocket 协议不会进入通用接口。
- 顶层 `shared` 保存可被多个 runtime 或 client/server 共同使用的纯领域逻辑。这里的模块必须可测试、
  JSON-safe，不拥有网络、文件系统、凭据、React 状态或宿主 Runtime 对象。
- `shared/agent-command` 拥有 Composer 消费的通用 Agent 命令语义；assistant-ui Host、Pi client 和
  server command capability 都直接依赖这个拥有者，不通过 UI 目录转发。
- `shared/agent-runtime/descriptor.ts` 只定义一个可序列化的稳定 Runtime 身份。它不包含 Provider、
  transport、SDK capability、工厂列表或选择策略；同一个具体实现的 client/server adapter 必须复用
  同一 descriptor。
- `shared/composer` 拥有 Composer canonical 请求、持久化投影和兼容读取规则；不要在 UI 或 RPC
  handler 中复制这些语义。面向具体 Agent SDK 的最终 Prompt 编码属于对应实现层。
- `shared/attachment-understanding` 拥有图片/PDF 附件理解的声明、解析模型和跨端状态机；具体 OCR
  网络调用、凭据与 Pi 模型执行属于 `pi/server/attachment-understanding`。
- `pi/contracts` 是 Pi client/server 之间的稳定协议层；`pi/shared` 只放 Pi client/server 复用的
  纯逻辑。`pi/shared` 不等同于顶层 `shared`，不应承载 Pi 之外的通用领域模块。
- `pi/client` 不导入 `pi/server`，`pi/server` 也不导入 `pi/client`。Node、文件系统、凭据和
  `@earendil-works/pi-coding-agent` Runtime 对象只留在 `pi/server`。
- `terminal` 拥有独立的双向协议和生命周期，不导入 Pi client/server，也不复用 Pi 的 downlink
  stream；共同的请求信任策略由顶层 server 组合根注入。

新增文件时优先放到拥有其状态或副作用的目录。只有同时被多个运行环境使用、且不拥有宿主资源的
逻辑才进入顶层 `shared`；只在 Pi 内部跨 client/server 复用的逻辑进入 `pi/shared`。

## Agent Runtime 接入

[`assistant-ui/agent-runtime-adapter.ts`](./assistant-ui/agent-runtime-adapter.ts) 是 Workbench 与 Agent
Runtime 之间的最小接入端口。端口复用 assistant-ui 已有抽象，只约定：

- 一个稳定的实现 ID；
- assistant-ui 的 `RemoteThreadListAdapter`；
- 将当前会话暴露为 `AssistantRuntime` 的 React hook；
- 将当前会话或新会话资源目标的动态命令投影为 `WorkbenchAgentCommand` 的 React hook；
- 可选的后台 thread presentation store，提供逐会话 revision/snapshot/subscription，以及 pin、
  workspace 内排序等可选操作；
- 外部会话列表结构 revision 及其订阅；
- 通过 thread extras 暴露的少量可选通用能力，例如 workspace、队列、运行计时、恢复和 Composer
  错误。

它不定义第二套消息模型、流协议、工具协议或 Agent SDK。thread presentation 只补充 assistant-ui
无法从未挂载后台会话提供的展示 metadata，不复制消息或 Composer 状态。消息、事件和错误如何转换，
由具体实现层负责；通用 Workbench 只消费 assistant-ui Runtime、命令目录、thread presentation 和
明确声明的通用 extras。

命令端口只描述 Composer 需要的稳定语义，不复制具体 Runtime 的 RPC DTO。Pi 的 `CommandView` 在
`pi/shared/commands/command-projection.ts` 内投影，浏览器 catalog 与服务端 capability 共同复用；
Workbench Composer 只调用
`useWorkbenchAgentCommands()`；扩展侧本地 `ComposerCommandRegistry` 仍是另一项独立能力。当前
Composer wire 的结构化节点写入 `source: "agent"`，`sourceText` 使用
`[$label](command://<agent|workbench>/<id>?args=<encoded-json>)` 资源链接；Skill 使用同形的
`[$label](skill://<scope>/<name>)`。`agent-command`、`pi-command` 与 `source: "pi"` 只由版本化兼容
读取器接受，不代表 UI 可以反向依赖 Pi。

浏览器安装边界位于
[`assistant-ui/agent-runtime-installation.tsx`](./assistant-ui/agent-runtime-installation.tsx)。它只把应用
已经选择好的完整实现挂载到 React tree，不创建 manager、transport 或 adapter，也不发现实现。
[`workbench/providers/installed-agent-runtime.tsx`](../workbench/providers/installed-agent-runtime.tsx) 是当前
唯一允许选择具体实现的应用组合点；它以 singular factory 安装 Pi，未维护数组、Map、动态 import、
配置枚举或 fallback。Pi 的 installation 再由 `PiAgentRuntimeProvider` 创建 manager 和 adapter，最后交给
通用 `WorkbenchAgentRuntimeHost`。

以后接入 Codex 或 Claude Code 时，应分别新增自己的 descriptor、client/transport、assistant-ui adapter、
完整实现 Provider 和 server installation，再修改这个显式应用组合点。在第二个生产实现真正出现前不
增加 registry、配置 UI 或空壳实现，避免提前固化尚未验证的共同能力。

服务端对应边界位于 [`server/agent-runtime-adapter.ts`](./server/agent-runtime-adapter.ts)、
[`server/agent-execution-port.ts`](./server/agent-execution-port.ts)、
[`server/agent-thread-store-port.ts`](./server/agent-thread-store-port.ts) 和
[`server/agent-command-catalog-port.ts`](./server/agent-command-catalog-port.ts)。`SessionRpcService` 先把
Pi wire 请求规范化为 `threadId`、`rootPath`、结构化 Prompt、附件和 mutation，再通过组合根安装的
Pi adapter 调用既有 registry/host；adapter 把 Pi summary 与错误码归一化，service 再投影回现有 wire。
Pi 的 `AgentSession`、`PiQueuedPrompt`、`CommandView`、字符串 Prompt 编译和错误码不会进入通用端口。

Pi canonical history、branch/resume 和 session model/context policy 继续属于 Pi protocol，分别由
`pi/server/sessions/pi-session-history-service.ts` 与
`pi/server/sessions/pi-session-model-context-service.ts` 封装 registry/SDK 细节，再由
`SessionRpcService` 编排。它们刻意没有提升到顶层 `runtime/server`：这些语义尚未被第二个 Agent
Runtime 验证，提前通用化会把 Pi event 与 context policy 伪装成跨 Runtime 标准。

服务端的 [`server/agent-runtime-installation.ts`](./server/agent-runtime-installation.ts) 同样只实例化一个
已选择的 adapter，并强制其 `id` 与共享 descriptor 一致。Pi session facade 显式调用
`createPiAgentServerInstallation()`，默认端口图仍由原 Pi adapter 创建；这里没有全局容器或实现
registry。
Pi 的 `CommandService` 保留原生 wire 输出，同时实现通用 command capability；线程 CRUD 经
`PiAgentThreadStoreAdapter` 接入。canonical session history/event 仍由 Pi protocol 拥有：在 Codex 或
Claude Code 的真实协议出现前，把它们抽成所谓“通用消息/事件模型”只会制造第二套未经验证的抽象。
后续实现先接入现有三个端口，再用两个实现共同验证出的语义扩展 `WorkbenchAgentServerAdapter`。

浏览器和服务端分别提供可复用的 conformance suite：
`assistant-ui/testing/agent-runtime-adapter-contract.tsx` 从真实 `WorkbenchAgentRuntimeHost` 观察 Runtime、
命令、thread presentation、revision/subscription 和 assistant-ui capabilities；
`server/testing/agent-server-adapter-contract.ts` 观察三个服务端端口的成功值与稳定错误。两套 suite 都先
由不依赖 Pi 的 fixture 验证，再由 Pi 实现调用。未来实现应复用这些测试，而不是复制 Pi 测试、模拟 Pi
协议，或为了通过测试提前引入 registry。

`assistant-ui` 位于 `runtime` 而不是组件目录，是因为这里保存的是状态机与宿主 Runtime 的适配和
生命周期组合，不是聊天界面的视觉组件；真正的 UI 仍位于 `components/`、`workbench/` 和
`extensions/`。

`attachment-understanding` 是物理领域目录名，因为当前能力同时覆盖图片和 PDF。为兼容现有线协议、
配置文档和历史事件，对外的 `imageUnderstanding.*` RPC、`imageUnderstanding` 设置字段以及 legacy
`workbench.image-recognition.v1` 名称仍保持不变；目录整理不等于协议迁移。
