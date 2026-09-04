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
