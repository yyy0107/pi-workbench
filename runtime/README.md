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
│   ├── tool-events.ts
│   └── use-workbench-runtime.ts
├── shared/                          # 跨 runtime、client/server 的纯领域逻辑
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
- `pi/client/assistant-ui` 是当前唯一的 Agent Runtime 实现层，负责把 Pi session、队列、恢复、错误
  和附件能力投影为 assistant-ui Runtime；Pi 的 HTTP/WebSocket 协议不会进入通用接口。
- 顶层 `shared` 保存可被多个 runtime 或 client/server 共同使用的纯领域逻辑。这里的模块必须可测试、
  JSON-safe，不拥有网络、文件系统、凭据、React 状态或宿主 Runtime 对象。
- `shared/composer` 拥有 Composer 请求、持久化投影和编译规则；不要在 UI 或 RPC handler 中复制
  这些语义。
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
- 外部会话列表发生结构变化时的订阅；
- 通过 thread extras 暴露的少量可选通用能力，例如队列、运行计时、恢复和 Composer 错误。

它不定义第二套消息模型、流协议、工具协议或 Agent SDK。消息、事件和错误如何转换，由具体实现层
负责；通用 Workbench 只消费 assistant-ui Runtime 和明确声明的通用 extras。

当前组合根只安装
[`pi/client/assistant-ui/adapter.ts`](./pi/client/assistant-ui/adapter.ts)。以后接入 Codex 或 Claude Code
时，应分别新增自己的 client/transport 和 assistant-ui adapter，实现同一端口，再在组合根选择实现。
在第二个实现出现前不增加 registry、配置 UI 或空壳实现，避免提前固化尚未验证的共同能力。

`assistant-ui` 位于 `runtime` 而不是组件目录，是因为这里保存的是状态机与宿主 Runtime 的适配和
生命周期组合，不是聊天界面的视觉组件；真正的 UI 仍位于 `components/`、`workbench/` 和
`extensions/`。

`attachment-understanding` 是物理领域目录名，因为当前能力同时覆盖图片和 PDF。为兼容现有线协议、
配置文档和历史事件，对外的 `imageUnderstanding.*` RPC、`imageUnderstanding` 设置字段以及 legacy
`workbench.image-recognition.v1` 名称仍保持不变；目录整理不等于协议迁移。
