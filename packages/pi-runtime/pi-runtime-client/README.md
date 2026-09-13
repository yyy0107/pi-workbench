# `@workbench/pi-runtime-client`

Pi 的浏览器侧 Headless Runtime 实现。

## State flow

```text
Pi transport events / history
  -> PiClientSession
  -> canonical PiConversationMessage repository
  -> PiConversationAssembler
  -> Workbench ConversationSnapshot + stable Node/Block observables
  -> Shell renderers and extension Slots
```

`PiClientSession` 是单个会话历史、实时流、乐观消息、队列、交互与运行状态的唯一可变 owner。
`PiSessionManager` 实现 `AgentRuntime`，负责目录、选择、会话缓存与传输帧路由。应用安装层把同一个
manager 放入 `RuntimeProvider`；不会创建第二套消息 store、reducer、连接或协议。

Each client session receives the finite `PiClientSessionDependencies` contract. The manager binds
installation-scoped transport, catalog, model, feedback, and fork operations through callbacks; the
session never receives the manager object. Message projection remains in `pi-conversation-adapter`, and the
single connection/generation owner remains in `pi-rpc-client`.

## Internal boundaries

- `transport/`：RPC/WebSocket、generation、watermark 与 gap detection
- `runtime/manager.ts`：会话目录、选择、元数据、缓存与帧路由
- `runtime/session.ts`：单个会话状态与 Headless actions
- `conversation/`：规范化 Pi 消息、repository、Node/Block 投影与结构共享
- `integration/`：React Provider、命令目录、workspace 与 thread store 接线

未变化的 Node/Block 引用保持稳定。普通发布使用 microtask，流式 delta 使用当前 animation-frame
边界，终态立即发布。

## Public boundary

消费者只能使用显式 feature subpath。该包不暴露 root barrel、原始 transport、manager class 或
manager React Context；跨层代码直接导入能力 owner，而不是把 `runtime/manager.ts` 当内部 barrel。

应用组合入口使用 `./installation` 安装 Pi Runtime，使用 `./workbench-settings` 创建绑定当前 Host 的
Workbench settings port。Pi Contributions 只消费以下专属入口：

- `./configuration`：Agent Settings、Provider 认证与模型配置；
- `./resources`：Toolbox 的 Skill、Extension、Prompt、Package 及资源文件；
- `./context-trace`：Pi trace 查询、事件订阅和 Data Block 投影；
- `./external-import`：外部会话扫描与导入；
- `./usage-statistics`：按本地日期读取已保存会话的 Token 与聊天活动汇总；按 Runtime 实例保留上次快照，页面重开先显示同一时区的缓存，再后台刷新；
- `./host`、`./workspace`：Pi Version/Toolbox 所需的只读订阅；
- `./errors`：Pi 专属错误及资源文件边界的 Workbench 错误映射。

Shell 的 host、workspace、model selection、interaction、scratch session、context、automation 和
attachment 功能通过 `WorkbenchAgentRuntimeCapabilities` 访问同一个 manager。通用消息和线程状态
使用 Workbench projection；相关 Pi RPC 和投影 helper 留在实现内部，不提供重复的公开 facade。

Source layout: src owns this capability and its contracts; lib contains consumed internal helpers; tests live at the package root. Example consumer: `src/runtime/manager.ts` imports `lib/fork-title.ts`. Capability and helper code remains TS/TSX; existing build tooling retains its language.

Spec008 internal owners: `runtime/manager-catalog.ts` owns directory snapshots, ordering, pin/archive deltas and request generation. `runtime/session-history.ts` owns canonical history, branch/page state, sequence acceptance, index invalidation and page deduplication; `runtime/session-attachments.ts` owns uploads, preparation and attachment cleanup. `manager.ts` coordinates the installed runtime and `session.ts` coordinates one conversation using the finite dependency contract. They retain one connection and authoritative message graph. Host event notification timing remains unchanged.
