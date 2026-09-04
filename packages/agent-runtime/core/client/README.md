# `@workbench/agent-runtime-client`

Workbench 浏览器侧、与具体 Agent 实现无关的 Headless Runtime React 接入层。

`RuntimeProvider` 保存稳定的 `AgentRuntime`，`SessionProvider` 绑定当前或显式指定的 Session。
`useThreadList`、`useCurrentSession`、`useSessionState`、`useConversationNode` 与
`useConversationNodes` 通过 external-store 订阅 Runtime 的规范化快照。

`AgentRuntime.current` 同时暴露稳定的本地 `sessionId` 与晋升后才存在的 durable `threadId`：前者绑定
消息 Session，后者用于路由和目录操作。线程变更统一通过 `threadActions`，本地 draft 不会提前创建
远端会话。

## Public entries

- `@workbench/agent-runtime-client`：Provider、selector hooks、storage 与通用 tool helpers
- `@workbench/agent-runtime-client/environment`：commands、thread store、workspace search 等宿主端口
- `@workbench/agent-runtime-client/context`：Runtime 环境与能力 hooks
- `@workbench/agent-runtime-client/capabilities`：可选能力契约与稳定的 `WorkbenchAgentCapabilityError`
- `@workbench/agent-runtime-client/installation`：应用组合根安装边界
- `@workbench/agent-runtime-client/message-statistics`：基于 Headless Node/Block 的统计聚合
- `@workbench/agent-runtime-client/prompt-feedback`：workspace feedback 窄接口

该包不定义具体 Agent 协议或连接；React 由宿主应用提供，确保 Workbench 只有一个 React 实例。

`WorkbenchAgentRuntimeEnvironmentProvider` 接收只读能力集合：host、workspace、models、interactions、
scratchSessions、context、automation 和 attachmentUnderstanding。通用 UI 从 `/context` 的窄 hooks
读取对应能力；缺失时隐藏入口或显示明确不可用状态，不根据 Runtime ID 分支或注入 no-op 实现。
具体 Runtime 负责把传输错误转换为 Workbench 错误；通用 UI 只消费稳定错误码与 Workbench DTO。
`WorkbenchBoundSessionProvider` 使用实现方提供的 session binding 绑定 Side Chat 等嵌套会话，
不改变外层会话选择，也不创建第二份状态缓存。
