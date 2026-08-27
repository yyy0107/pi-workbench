# Workbench Agent Runtime Adapter

本目录是 Workbench 浏览器侧的 Agent Runtime 接入边界。它复用 assistant-ui 的 Runtime、
`RemoteThreadListAdapter` 和 `runtimeHook`，不再定义一套平行的消息或流协议。

```text
Workbench UI
    │ consumes AssistantRuntime + generic thread extras
    ▼
useWorkbenchRuntime
    │ coordinates a RemoteThreadListRuntime
    ▼
WorkbenchAgentRuntimeAdapter
    │ current implementation
    ▼
Pi adapter ──> PiSessionManager ──> Pi HTTP/WebSocket transport
```

## 文件职责

- [`agent-runtime-adapter.ts`](./agent-runtime-adapter.ts) 定义稳定的实现端口，以及 Workbench 会消费的
  可选 thread extras。这里不得出现 Pi、Codex 或 Claude Code 的 SDK/协议类型。
- [`use-workbench-runtime.ts`](./use-workbench-runtime.ts) 只负责用 adapter 组合 assistant-ui 多会话
  Runtime，并在实现层报告会话列表结构变化时触发 reload。
- `adapters/` 保存可跨 Agent Runtime 复用的 assistant-ui 附件、反馈和历史适配。
- Pi 的具体实现位于 [`../pi/client/assistant-ui/adapter.ts`](../pi/client/assistant-ui/adapter.ts)。

## 实现约束

一个 Agent Runtime 实现应自行拥有：

- SDK 或远程 transport 的连接与生命周期；
- 原生 session/thread 到 assistant-ui message/thread 的投影；
- 增量事件、重连、取消、重试和错误归一化；
- 原生队列、恢复检查点等能力到 `WorkbenchAgentRuntimeExtras` 的投影；
- 后端专属能力及其 UI 扩展。

通用层只把 `checkpointId`、`expectedStateId` 等值当作 opaque identifier，并原样回传给产生它们的实现。
实现可以没有某项可选 extras；Workbench 应按 capability 缺失降级，而不是猜测 SDK 类型。

## 新增实现

新增 Codex、Claude Code 或其他 Agent Runtime 时：

1. 在自己的 runtime 目录内建立 client/transport，保持原生协议私有；
2. 实现 `WorkbenchAgentRuntimeAdapter`，选择适合该 SDK 的 assistant-ui Runtime 构造方式；
3. 只投影 Workbench 实际需要的通用 extras，不照搬 Pi manager API；
4. 在应用组合根实例化并选择 adapter；
5. 只有两个以上实现确实需要动态选择时，再引入 registry 与配置 UI。

Pi 专属的模型目录、Skills、Extensions、Context Trace 等能力不属于核心端口。未来实现可以通过独立、
可选的 capability/extension 接入，而不把所有 Agent SDK 强行压成一个巨型接口。
