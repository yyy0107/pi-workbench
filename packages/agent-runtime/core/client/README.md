# `@workbench/agent-runtime-client`

Workbench 浏览器侧的、与具体 Agent 实现无关的 assistant-ui Runtime 接入层。

它直接复用 assistant-ui 的 Runtime、`RemoteThreadListAdapter`、Provider、消息和线程状态，
只提供 Workbench 需要的 adapter 端口、Host、Runtime context、extras readers 及通用浏览器 adapters；
不定义第二套消息、线程或流协议，也不依赖 Pi 或其他具体 Agent Runtime。

## Public entries

- `@workbench/agent-runtime-client`：Host、Runtime hook、通用浏览器 adapters、storage 与 tool helpers
- `@workbench/agent-runtime-client/adapter`：实现端口、thread presentation 与 extras 类型
- `@workbench/agent-runtime-client/context`：Runtime identity、commands、thread snapshot/actions hooks
- `@workbench/agent-runtime-client/extras`：对 assistant-ui `thread.extras` 的独立校验 readers
- `@workbench/agent-runtime-client/installation`：应用组合根安装边界

内部 reload coordinator、attachment/feedback adapter 实现不作为独立 subpath 暴露；需要这些能力的
具体 Runtime 通过根入口使用稳定 API。React 由宿主应用提供，确保整个 Workbench 只有一个 React 实例。
