# `@workbench/agent-runtime-client`

Workbench 浏览器侧、与具体 Agent 实现无关的 Headless Runtime React 接入层。

`RuntimeProvider` 的 Context 只保存稳定 `AgentRuntime`；`SessionProvider` 通过稳定 session id
限定并切换会话子树。`useThreadList`、`useSessionState` 和 `useConversationNode` 使用
selector-aware external-store 订阅，未选中的 snapshot 变化不会触发组件重渲染。

迁移期间，该 package 继续保留 assistant-ui Host、adapter 端口、extras readers 和通用浏览器
adapters 作为兼容边界。新旧 React 路径读取同一个具体 Runtime/Session，不定义第二套消息、线程、
流协议或连接，也不依赖 Pi 或其他具体 Agent Runtime。

## Public entries

- `@workbench/agent-runtime-client`：`RuntimeProvider`、`SessionProvider`、selector hooks，以及临时兼容
  Host、通用浏览器 adapters、storage 与 tool helpers
- `@workbench/agent-runtime-client/adapter`：实现端口、thread presentation 与 extras 类型
- `@workbench/agent-runtime-client/context`：Runtime identity、commands、thread snapshot/actions hooks
- `@workbench/agent-runtime-client/extras`：对 assistant-ui `thread.extras` 的独立校验 readers
- `@workbench/agent-runtime-client/installation`：应用组合根安装边界

内部 reload coordinator、attachment/feedback adapter 实现不作为独立 subpath 暴露；需要这些能力的
具体 Runtime 通过根入口使用稳定 API。React 由宿主应用提供，确保整个 Workbench 只有一个 React 实例。
