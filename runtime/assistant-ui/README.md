# Workbench Agent Runtime Adapter

本目录是 Workbench 浏览器侧的 Agent Runtime 接入边界。它复用 assistant-ui 的 Runtime、
`RemoteThreadListAdapter` 和 `runtimeHook`，不再定义一套平行的消息或流协议。

```text
Workbench UI
    │ consumes AssistantRuntime + generic thread/command hooks
    ▼
WorkbenchAgentRuntimeHost
    │ installs AssistantRuntimeProvider + Agent Runtime environment
    ▼
useWorkbenchRuntime
    │ coordinates one RemoteThreadListRuntime + reload policy
    ▼
WorkbenchAgentRuntimeAdapter
    │ current implementation
    ▼
Pi adapter ──> PiSessionManager ──> Pi HTTP/WebSocket transport
```

## 文件职责

- [`agent-runtime-host.tsx`](./agent-runtime-host.tsx) 是后端无关的 React Host，只组合选中的 adapter、
  `useWorkbenchRuntime()`、assistant-ui 的 `AssistantRuntimeProvider` 和通用 Runtime 环境。
- [`agent-runtime-adapter.ts`](./agent-runtime-adapter.ts) 定义稳定的实现端口，以及 Workbench 会消费的
  command catalog Hook、可选 thread presentation store 与 thread extras。这里不得出现 Pi、Codex
  或 Claude Code 的 SDK/协议类型。
- [`../shared/agent-command/catalog.ts`](../shared/agent-command/catalog.ts) 定义 Composer 实际需要的
  后端无关命令 DTO：调用名、效果、互斥性、参数 schema/binding，以及 extension、prompt、skill 的
  可选资源来源。它属于共享领域层，不由 React Host 目录拥有。
- [`agent-runtime-context.tsx`](./agent-runtime-context.tsx) 提供后端无关的 Runtime ID、命令目录、
  单线程/批量线程展示快照和可选 thread actions Hook。线程状态通过 revision 使用
  `useSyncExternalStore`，不复制实现层状态。
- [`agent-runtime-extras.ts`](./agent-runtime-extras.ts) 是 thread extras 的唯一运行时读取边界。UI 不直接
  对 `unknown` 做实现专属断言；各 reader 独立校验自己消费的 capability，因此一个损坏的可选字段不会
  隐藏其他有效能力。
- [`use-workbench-runtime.ts`](./use-workbench-runtime.ts) 只负责用 adapter 组合 assistant-ui 多会话
  Runtime，并在实现层报告会话列表结构变化时触发 reload。
- [`thread-list-reload-coordinator.ts`](./thread-list-reload-coordinator.ts) 合并同一轮通知，保证 reload
  单飞；请求进行中收到的任意数量通知最多再追加一次 reload。
- `adapters/` 保存可跨 Agent Runtime 复用的 assistant-ui 附件、反馈、语音输入和历史适配。
- `testing/` 提供不依赖 Pi 的 fixture，用于锁定 Host、Strict Effects 和 adapter replacement 契约。
- [`dependency-boundary.test.ts`](./dependency-boundary.test.ts) 阻止通用生产模块反向导入 Pi。
- Pi 的具体实现位于 [`../pi/client/assistant-ui`](../pi/client/assistant-ui)。

## Thread List 一致性

`RemoteThreadListAdapter` 是 pull-based；实现层不直接操作 assistant-ui 的列表。每个
`WorkbenchAgentRuntimeAdapter` 必须提供单调递增的 `getThreadListRevision()` 和对应订阅：

- 只有远端成员增删、`regular`/`archived` 变化或展示顺序变化才递增 revision；
- 标题、运行状态、消息、计时等 metadata-only 更新不递增 revision；
- 第一次 `threadListAdapter.list()` 建立结构基线，不把冷启动数据误报成增量；
- 本地新会话由 `RemoteThreadListAdapter.initialize()` 完成 local-to-remote promotion。实现应记录
  promotion 后的结构基线，不再发布一次会把同一会话拉成重复 remote item 的 invalidation；
- 通用 Hook 只观察 revision，不订阅实现层的宽泛状态；同一批变更合并成一次 reload，进行中的变更
  最多触发一次 trailing reload。

更换整个 adapter 时，新实现当前 revision 只作为新基线，不会用旧实现的 revision 触发 reload。

## Thread Presentation

assistant-ui 管理当前挂载会话的消息、Composer 和运行状态，但侧栏还需要观察未挂载后台会话的标题、
运行状态、等待输入、未读完成、置顶和 workspace。实现可通过 `threadStore` 投影这些只读展示字段，并
按需提供 `setPinned`、`moveWithinWorkspace`：

- `getRevision(threadId)` 与 `subscribe(threadId)` 是 React 的订阅身份；
- `getSnapshot(threadId)` 可以即时从实现层权威状态生成不可变投影，无需维护第二份缓存；
- 当前会话的活动态仍可与 assistant-ui `threadListItem.isRunning` 合并，不能用 presentation store
  取代 assistant-ui 的消息/运行模型；
- capability 缺失时 UI 隐藏对应操作；本地展示和 assistant-ui 自带的 archive 等能力继续可用；
- Workbench 的 Sidebar、Header 和 Terminal launch 只消费此通用端口，不导入具体 Runtime。

Pi 的实现位于
[`../pi/client/assistant-ui/thread-store.ts`](../pi/client/assistant-ui/thread-store.ts)，它直接包装
`PiSessionManager` 已有的 per-thread revision/snapshot/subscription，并只做字段映射。

## Composer Command Catalog

命令有两个不同的拥有者，不能合并成一个隐式全局表：

- Agent Runtime 通过 `useCommandCatalog()` 提供当前会话或新会话资源目标可执行的动态目录；
- Workbench 扩展通过 `ComposerCommandRegistry` 注册本地 UI 命令、companion semantics 或展示覆盖。

Host 在 assistant-ui Provider 内调用所选实现的 Hook，并通过 `useWorkbenchAgentCommands()` 只暴露
不可变的 `WorkbenchAgentCommand`。实现必须在自己的目录内把原生 RPC/SDK 项投影为该 DTO；Workbench
Composer 不得导入具体 Runtime。Pi 当前在
[`../pi/client/assistant-ui/command-catalog.tsx`](../pi/client/assistant-ui/command-catalog.tsx) 中订阅活动
session、workspace target 和资源 catalog revision，然后投影 `command.list`。

Composer document 的当前 wire 是 `version: 2`，统一写入 `agent-command`、
`agent-project-skill`、`agent-user-skill` 和 `source: "agent"`。具体 Runtime 名称不会进入草稿、RPC
或历史。兼容解析仍读取旧 `version: 1` 的 `pi-command`、`pi-project-skill`、`pi-user-skill` 与
`source: "pi"`，并在边界立即归一化为 Agent 语义；兼容标记不得用于新的写入。

## 实现约束

一个 Agent Runtime 实现应自行拥有：

- SDK 或远程 transport 的连接与生命周期；
- 原生 session/thread 到 assistant-ui message/thread 的投影；
- 原生命令目录到 `WorkbenchAgentCommand` 的投影与失效订阅；
- 后台 thread 展示状态与可选目录操作到 `WorkbenchAgentThreadStore` 的投影；
- 增量事件、重连、取消、重试和错误归一化；
- 原生队列、恢复检查点等能力到 `WorkbenchAgentRuntimeExtras` 的投影；
- 当前 thread 所属 workspace 到后端无关 `agentThread.workspace` extras 的投影；
- 后端专属能力及其 UI 扩展。

通用层只把 `checkpointId`、`expectedStateId` 等值当作 opaque identifier，并原样回传给产生它们的实现。
实现可以没有某项可选 extras；Workbench 应按 capability 缺失降级，而不是猜测 SDK 类型。

assistant-ui 的 `ExternalStoreRuntime` capability 由传入的 callback/adapter 推导，不另设一份 Workbench
布尔配置。当前版本要求提供 `setMessages` 才能启用 branch switching，同时也会把 message delete
标记为可用。Pi 的 `setMessages` 是分支切换桥接占位，持久变更由 `unstable_onBranchChange` 调用 Pi
session tree 完成；升级 assistant-ui 时必须通过 capability 契约测试重新确认这项耦合。

附件、反馈和浏览器语音输入由 `useWorkbenchRuntimeAdapters()` 统一安装。具体 Agent Runtime 只添加
自己拥有的执行、消息、分支、队列与恢复 callback，不重复创建这些 Workbench 浏览器能力。

应用组合根不创建实现层 manager。当前由 `PiAgentRuntimeProvider` 完整拥有 Pi manager、Fast Refresh
兼容生命周期、workspace selection、active/draft tracker 和 adapter 创建；命令目录由 adapter 的
`useCommandCatalog()` 安装。`WorkbenchAssistantRuntimeProvider` 只选择该实现，并安装后端无关的
Workspace Surface 桥接。

## 新增实现

新增 Codex、Claude Code 或其他 Agent Runtime 时：

1. 在自己的 runtime 目录内建立 client/transport，保持原生协议私有；
2. 实现 `WorkbenchAgentRuntimeAdapter`，选择适合该 SDK 的 assistant-ui Runtime 构造方式；
3. 把该 Runtime 的动态命令目录投影成 `WorkbenchAgentCommand`，没有命令时返回稳定空数组；
4. 用结构 revision 驱动 thread-list reload，并为初始 list 与本地 draft promotion 建立基线；
5. 只投影 Workbench 实际需要的 thread presentation 和通用 extras，不照搬 Pi manager API；
6. 复用共享 browser adapters，并用 capability 测试锁定实际 callback 组合；
7. 在应用组合根实例化并选择 adapter；
8. 只有两个以上实现确实需要动态选择时，再引入 registry 与配置 UI。

Pi 专属的模型目录、Skills、Extensions、Context Trace 等能力不属于核心端口。未来实现可以通过独立、
可选的 capability/extension 接入，而不把所有 Agent SDK 强行压成一个巨型接口。
