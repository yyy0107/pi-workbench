# `@workbench/agent-runtime-client`

Workbench 浏览器侧、与具体 Agent 实现无关的 Headless Runtime React 接入层。

`RuntimeProvider` 的 Context 只保存稳定 `AgentRuntime`；`SessionProvider` 默认绑定当前会话，也可通过
显式稳定 session id 绑定不改变全局选择的嵌套会话。`useThreadList`、`useCurrentSession`、`useSessionState`、
`useConversationNode` 和稳定对象 hook `useConversationSession` 使用
selector-aware external-store 订阅，未选中的 snapshot 变化不会触发组件重渲染。

`AgentRuntime.current` 同时暴露稳定的本地 `sessionId` 和晋升后才存在的 durable `threadId`；前者绑定
消息 Session，后者用于 URL 和目录操作。`threadActions` 统一承载 rename/archive/unarchive/delete、pin
和 workspace 内排序，`createDraft` 不提前创建远端会话。

迁移期间，该 package 继续保留 assistant-ui Host、adapter 端口、extras readers 和通用浏览器
adapters 作为消息/renderer 兼容边界，但生产 Thread List 和 Current Session 不再经过该 Host。新旧
React 路径读取同一个具体 Runtime/Session，不定义第二套消息、线程、流协议或连接，也不依赖 Pi 或
其他具体 Agent Runtime。

## Public entries

- `@workbench/agent-runtime-client`：`RuntimeProvider`、`SessionProvider`、selector hooks，以及临时兼容
  Host、通用浏览器 adapters、storage 与 tool helpers
- `@workbench/agent-runtime-client/adapter`：实现端口、thread presentation 与 extras 类型
- `@workbench/agent-runtime-client/context`：Runtime identity、commands、thread snapshot/actions hooks
- `@workbench/agent-runtime-client/extras`：对 assistant-ui `thread.extras` 的独立校验 readers
- `@workbench/agent-runtime-client/installation`：应用组合根安装边界

内部 reload coordinator、attachment/feedback adapter 实现不作为独立 subpath 暴露；需要这些能力的
具体 Runtime 通过根入口使用稳定 API。React 由宿主应用提供，确保整个 Workbench 只有一个 React 实例。
