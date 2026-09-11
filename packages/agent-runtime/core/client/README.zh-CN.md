# `@workbench/agent-runtime-client`

Workbench 浏览器侧、与具体 Agent Runtime 实现无关的 React 接入层。本包将 React UI 接入
React-free 的 Headless Agent Runtime，并有意保持对具体 Agent Runtime 实现的独立性。

## 职责

本包主要负责：

- 通过 `RuntimeProvider` 安装稳定的 `AgentRuntime`。
- 通过 `SessionProvider` 绑定当前会话，或绑定一个显式指定的嵌套会话。
- 通过 `useSyncExternalStore` 订阅线程列表、当前会话、Conversation Snapshot 和消息节点。
- 提供 selector hooks，避免未选中的消息内容变化造成不必要的 React 重渲染。
- 暴露与 Runtime 实现无关的 commands、thread store、workspace search 和可选 capabilities。
- 为 Workbench UI 提供统一的能力错误、浏览器存储、Composer attachment、tool event 和消息统计辅助逻辑。
- 定义 workspace selection、Runtime installation 和 nested session binding 的组合边界。

`AgentRuntime.current` 同时暴露两种身份：

- `sessionId`：稳定的本地内存 Session 身份，用于绑定消息状态。
- `threadId`：本地会话晋升后才存在的 durable 身份，用于路由、目录操作和线程变更。

本地 draft 可以先创建和切换，而不会提前创建远端会话。线程目录变更统一通过 `threadActions`
或对应的 thread capability 完成。

## 目录结构

```text
src/
  runtime/
    context.tsx              # AgentRuntime / ConversationSession React Context
    provider.tsx             # RuntimeProvider
    session-provider.tsx     # SessionProvider
    hooks.ts                 # Runtime、Session、Thread 和 Node selector hooks
    snapshot-selector.ts     # useSyncExternalStore selector 绑定
    node-selection.ts        # 多个 conversation node 的派生 observable

  environment/
    context.tsx              # Runtime environment Context 与 capability hooks
    ports.ts                 # Thread store 和 workspace-file-search ports
    capabilities.ts          # 可选 capabilities 与稳定错误类型
    installation.tsx         # 选定 Runtime 的 installation 边界

  workspace/
    selection.tsx            # Workspace selection Context 与 directory port

  browser/
    storage.ts               # localStorage 与内存 fallback
    composer-attachment.ts   # File 到 Composer attachment 的转换

  conversation/
    tool-events.ts           # Tool payload 辅助函数与 completed-call hook
    prompt-feedback.ts       # Prompt feedback port 与兼容性封装
    thread-list-reload.ts    # 合并线程列表刷新的协调器
    statistics.ts            # Message/node 统计聚合
    presentation-metadata.ts # 通用 reasoning 和 parallel-tool metadata

  index.ts                   # 主公共入口
```

## 公共入口

公共 subpath 由 `package.json` 的 `exports` 字段定义。调用方应使用 package import，
不要依赖 `src` 下的内部文件路径：

| 入口 | 用途 |
| --- | --- |
| `@workbench/agent-runtime-client` | Providers、selector hooks、storage、Composer 和通用 tool helpers |
| `@workbench/agent-runtime-client/environment` | Thread store、workspace file search 等 Runtime ports |
| `@workbench/agent-runtime-client/context` | Runtime environment Provider 与 capability hooks |
| `@workbench/agent-runtime-client/capabilities` | 可选 capability 契约与 `WorkbenchAgentCapabilityError` |
| `@workbench/agent-runtime-client/installation` | 应用组合根使用的 Runtime installation contract |
| `@workbench/agent-runtime-client/message-statistics` | 基于 Headless Node/Block 的统计聚合 |
| `@workbench/agent-runtime-client/message-presentation-metadata` | Reasoning 和 parallel-tool presentation metadata |
| `@workbench/agent-runtime-client/prompt-feedback` | Workspace prompt feedback 窄接口 |
| `@workbench/agent-runtime-client/workspaces` | Workspace selection 与 directory store port |

示例：

```tsx
import {
  RuntimeProvider,
  SessionProvider,
  useCurrentSession,
  useSessionState,
  useThreadList,
} from "@workbench/agent-runtime-client";
import {
  WorkbenchAgentRuntimeEnvironmentProvider,
  useWorkbenchWorkspaceCapability,
} from "@workbench/agent-runtime-client/context";
```

## 边界

本包不负责：

- 具体 Agent 协议、Pi SDK 或网络传输。
- 具体 Runtime manager、adapter 和 transport 生命周期。
- Server-side command、execution 或 thread port 的实现。
- Workbench Shell 的 Sidebar、Composer、Message 等视觉组件。
- Workspace 使用的具体 Zustand、Redux 或其他状态管理实现。

具体 Runtime 应在自己的 package 中实现 transport、manager 和 adapter，然后将它们映射为本包
定义的 `AgentRuntime`、`ConversationSession`、thread ports 和 capabilities。通用 Workbench UI
只能消费稳定的 Workbench DTO、错误码和 capability 接口，不应根据 Runtime ID 编写分支。

`RuntimeProvider` 和 `SessionProvider` 负责 Runtime/Session 的 React 绑定；
`WorkbenchAgentRuntimeEnvironmentProvider` 负责 commands、thread store、workspace search 和
可选 capabilities 的环境绑定。缺少可选能力时，相关 hook 返回 `undefined`，由 UI 隐藏入口或
显示明确的不可用状态。

## 开发检查

在仓库根目录执行：

```bash
pnpm --filter @workbench/agent-runtime-client typecheck
pnpm --filter @workbench/agent-runtime-client test
```

本包应保持以下依赖边界：生产代码不得直接导入具体 Agent Runtime；Runtime-neutral 的 thread
presentation 和 Composer consumer 也不得依赖具体实现。
