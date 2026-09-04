# `@workbench/agent-runtime-pi-client`

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
- `./host`、`./workspace`：Pi Version/Toolbox 所需的只读订阅；
- `./errors`：Pi 专属错误及资源文件边界的 Workbench 错误映射。

Shell 的 host、workspace、model selection、interaction、scratch session、context、automation 和
attachment 功能通过 `WorkbenchAgentRuntimeCapabilities` 访问同一个 manager。通用消息和线程状态
使用 Workbench projection；相关 Pi RPC 和投影 helper 留在实现内部，不提供重复的公开 facade。
