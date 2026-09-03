# Workbench 移除 assistant-ui 与自有会话 Runtime 迁移计划

状态：方向已确认；assistant-ui 专属 Agent skills 已删除，Phase 1 已完成，Phase 2 已完成 2A–2C、下一步 2D（2026-09-03）

## 0. 决策摘要

Workbench 将逐步删除所有 assistant-ui 依赖，参考 DeepSeek Harness 的 Session、事件窗口、
Conversation Node、稳定快照和 selector 订阅设计，实现 Workbench 自有的 Agent 会话 Runtime 与聊天 UI。

最终目标：

- 删除 `@assistant-ui/react`、`@assistant-ui/react-lexical`、
  `@assistant-ui/react-streamdown` 和 `assistant-stream`；
- 删除仓库内专用于 assistant-ui 的 Agent skills：`assistant-ui`、`markdown`、`primitives`、
  `runtime`、`setup`、`streaming`、`thread-list`、`tools` 和 `update`；
- 删除 `AssistantRuntimeProvider`、`useAui`、`useAuiState`、`RemoteThreadListAdapter`、
  `ThreadMessage`、`MessagePart` 以及所有 assistant-ui primitives；
- 由 Workbench 定义稳定的 Session、Conversation Node、Composer、Thread Catalog 和 Renderer 契约；
- Pi Client 继续作为第一个具体 Adapter，负责把 Pi 协议事件投影成 Workbench Conversation Snapshot；
- 保留现有 Pi Server、HTTP/WebSocket 边界和 Extension Platform，不引入第二条连接或第二套插件系统；
- 保留当前用户可见能力，架构迁移本身不顺带改变编辑、重试、附件、线程组织等产品语义。

本计划采用“最终全部删除、实施分阶段切换”的方式。assistant-ui 兼容投影只允许作为迁移脚手架存在，
不得成为长期双 Runtime。

## 1. 与既有架构的关系

2026-08-29 落地的 Agent Runtime 多 Package 架构是当前代码基线，不再保留单独的迁移计划文档。
该架构当时选择继续复用 assistant-ui，避免在同一交付中建立第二套浏览器消息和线程模型。

本计划是后续独立决策，只取代以下旧假设：

> 浏览器继续由 assistant-ui 管理 messages、Composer、thread state 和 Runtime scopes。

现有实现中的 Ports and Adapters、Pi Client/Server 分离、应用组合根、Extension Platform、package exports
和依赖边界继续有效；本计划不回滚或重新实现这些已经落地的边界。

相关参考：

- [DeepSeek Harness API 设计参考](./deepseekharness-api-design.md)
- `packages/agent-runtime/core/client/README.md`
- `packages/agent-runtime/adapters/pi/README.md`
- DeepSeek Harness 本地参考仓库：`/home/wy/projects/deepseek-harness`

## 2. 当前基线

截至本计划记录时，静态搜索在 `apps/` 和 `packages/` 中命中约 103 个直接使用
`@assistant-ui/*` 或 `assistant-stream` 的源码、测试和 manifest 文件。该数字用于描述迁移面，不是最终改动文件数。

直接依赖 assistant-ui 的 workspace package 包括：

- `@workbench/agent-runtime-client`；
- `@workbench/agent-runtime-testkit`；
- `@workbench/agent-runtime-pi-client`；
- `@workbench/agent-runtime-pi-contributions`；
- `@workbench/extension-sdk`；
- `@workbench/extension-host`；
- `@workbench/shell`。

当前主消息流已经是 Workbench/Pi 自定义实现：

```text
Pi Server
  -> events.mux / events.host
  -> PiConnectionController
  -> SessionMessageAccumulator
  -> PiClientSession snapshot
  -> useExternalStoreRuntime
  -> AssistantRuntimeProvider
  -> Workbench Thread / Message / Composer
```

`assistant-stream` 不承载 Pi 主消息流，目前只用于把已生成的会话标题包装成 assistant-ui 要求的流返回值。
因此删除 assistant-ui 的核心工作是替换浏览器 Runtime、状态作用域和 UI primitives，而不是重写已有 WebSocket。

## 3. 目标与非目标

### 3.1 目标

1. Workbench 拥有完整、稳定、可测试的浏览器会话对象模型。
2. 原始 Pi 事件是 Adapter 的事实源，Conversation Node 是 Shell 和扩展看到的稳定投影视图。
3. 历史与实时事件通过同一个 Assembler 处理，支持重放、重连去重、live buffering 和 gap repair。
4. Thread List、Conversation、Node、Composer 分别订阅自己需要的状态，避免 token 更新刷新整棵聊天树。
5. Snapshot 是不可变且缓存的；未变化的 Thread、Node、Block 保持引用稳定。
6. 所有动作通过稳定的 Runtime/Session actions 暴露，不依赖 React scope。
7. Renderer、Slot、Command、Panel、Workspace Surface 继续由现有 Extension Platform 管理。
8. 保持浏览器与 Pi Server 的安全边界：浏览器只接收稳定、JSON-compatible 的 RPC/stream 数据。
9. 迁移结束后，全仓不再编译、运行或导出 assistant-ui 类型和组件。

### 3.2 非目标

- 不直接安装或嵌入 `@deepseek-ai/dsh-client-runtime`；
- 不引入 Cordis、DSH API Remotes、DSH Session 类型或 DSH 插件系统；
- 不创建新的 WebSocket、Pi AgentSession 或服务端 Runtime；
- 不把所有后端事件强行转换成一个“通用 AgentEvent”最低公分母；
- 不在迁移中重新设计视觉系统；
- 不为每个 Message、Composer 或 Thread 小组件创建独立 workspace package；
- 不在 React Runtime 替换阶段同时改变服务端持久化格式；
- 不默认引入虚拟列表、Redux 或新的状态管理依赖；
- 不复制 assistant-ui 的动态 scope DSL 或 compound primitives API。

## 4. 设计原则

### 4.1 单一事实源

每个会话只能有一个可变状态所有者：具体 Adapter 的 Session 对象。

迁移期间可以从同一个 `PiClientSession` 同时派生：

```text
PiClientSession
  |- Workbench ConversationSnapshot
  `- assistant-ui ThreadMessage compatibility projection
```

这是临时双投影，不是两套 store。禁止让两个 reducer 分别消费同一条 live stream，也禁止把 messages、
composer content 或 `isRunning` 复制到 Zustand。

### 4.2 Package 按依赖边界拆，组件按职责拆

只有满足以下至少一项时才创建 workspace package：

- 有独立运行环境；
- 需要阻止一类依赖进入；
- 有多个真实消费者；
- 有独立公开 API 和测试边界；
- 需要独立构建或发布。

React 组件的可组合性不等于每个组件都必须成为 package。单一 Shell 内部使用的组件优先保留为目录模块。

### 4.3 Snapshot 与 Actions 分离

Snapshot 只包含可观察数据；Actions 保持稳定引用。token delta 不应因为新建回调对象而触发无关组件更新。

### 4.4 Adapter 保留原始协议语义

Pi wire event、Pi message、revision、watermark、tool delta 只存在于 Pi Protocol/Client。Core 和 Shell
只看到 Workbench-owned Snapshot、Node 和 Action 契约。

### 4.5 扩展系统只保留一套

现有 Extension Platform 已具备 Slot、Renderer、Command、Panel、Opener、Settings、Main View 和
Workspace Surface。迁移只替换 Renderer 输入类型，不复制 DSH 的 Cordis/Slot 系统。

### 4.6 先保持行为，再讨论产品简化

迁移默认保持当前可见行为。以下变化必须单独形成产品决策：

- 将线程内 branch 改成只允许 fork 新 Session；
- 改变本地 draft/首次发送 promotion 语义；
- 删除 edit、retry、feedback、quote、attachment 或 queue 能力；
- 改变线程归档、置顶、workspace 分组和未读完成行为。

## 5. 目标 Package 架构

```text
packages/
|- agent-runtime/
|  |- core/
|  |  |- contracts/          # 已有：跨 Runtime 的纯数据契约
|  |  |- runtime/            # 新增：无 React 的 Headless Runtime
|  |  |- client/             # 已有：React Provider 与 selector hooks
|  |  |- server/             # 已有：服务端通用 ports
|  |  `- testkit/            # 已有：Fake Runtime 与契约测试
|  `- adapters/
|     `- pi/
|        |- protocol/        # 已有：HTTP/WebSocket wire types
|        |- shared/          # 已有：Pi client/server 共享逻辑
|        |- client/          # Pi Session、Assembler、transport
|        |- server/          # Pi SDK、RPC、持久化和 stream hub
|        `- contributions/   # Pi-owned UI extensions
|- extension-platform/
|  |- sdk/                   # Workbench Renderer/Slot contracts
|  `- host/                  # Registry、RendererHost、错误隔离
`- workbench/
   `- shell/
      |- src/chat/           # Thread、Conversation、Message、Composer
      `- src/ui/             # 共享视觉 primitives

apps/
`- web/
   `- src/workbench/         # 只做 Runtime、Shell、扩展安装组合
```

### 5.1 唯一新增的 package

新增：

```text
packages/agent-runtime/core/runtime
```

建议 package 名：

```json
{
  "name": "@workbench/agent-runtime-core"
}
```

该 package 提供无 React、无 Pi、无 Shell 的 Headless Runtime 基础：

```text
src/
|- observable.ts
|- notifier.ts
|- runtime.ts
|- thread-manager.ts
`- index.ts
```

首个版本只实现已有迁移需求。不得预先加入通用事件引擎、插件系统、持久化接口、网络协议、模型接口或
多前端框架抽象。

### 5.2 暂不创建独立 chat-ui package

聊天 UI 继续位于 `packages/workbench/shell/src/chat/`，因为它当前真实依赖：

- Workbench 全局视觉 token；
- `packages/workbench/shell/src/ui/`；
- Extension Host；
- Composer Commands；
- Workbench 路由、布局和 RightWorkspace。

只有满足以下条件之一时，才考虑抽取 `@workbench/chat-ui`：

1. 第二个产品 Shell 需要复用聊天组件；
2. 需要在 Workbench 外独立构建或发布；
3. Shell 与 chat 之间出现无法通过 public contract 消除的真实依赖环；
4. 需要独立的版本、Storybook 或构建产物。

### 5.3 允许的依赖方向

```text
@workbench/agent-runtime-contracts
        |
        |--> @workbench/agent-runtime-core
        |          |--> @workbench/agent-runtime-client
        |          `--> @workbench/agent-runtime-pi-client
        |
        `--> @workbench/extension-sdk
                   `--> @workbench/extension-host

@workbench/agent-runtime-pi-protocol
        `--> @workbench/agent-runtime-pi-client

@workbench/agent-runtime-client + @workbench/extension-host
        `--> @workbench/shell

apps/web
        `--> 安装 shell、Pi Runtime installation 和 extensions
```

禁止：

```text
agent-runtime core/contracts -> Pi
agent-runtime core/runtime   -> React / Pi / Shell
workbench shell              -> Pi 私有 protocol/runtime 文件
Pi client                    -> Workbench Shell
extension-sdk                -> Pi Client
browser                      -> @earendil-works/pi-coding-agent
Pi server                    -> React
```

## 6. Core Runtime 对象模型

以下 API 是方向性契约，实施时以最小可用字段为准，不要求一次性固定全部方法。

### 6.1 Observable

```ts
export interface HostObservable<T> {
  getSnapshot(): T;
  subscribe(listener: () => void): () => void;
}
```

这是 Headless Runtime 与 React 绑定之间唯一必要的响应式协议。

### 6.2 AgentRuntime

```ts
export interface AgentRuntime {
  readonly threads: HostObservable<ThreadListSnapshot>;
  readonly current: HostObservable<CurrentSessionSnapshot>;

  session(id: string): ConversationSession | undefined;
  createThread(options?: CreateThreadOptions): Promise<string>;
  switchToThread(id: string): void;
  switchToNewThread(): void;
}
```

职责：

- thread catalog；
- current selection；
- draft/new-thread 生命周期；
- Session 缓存与释放；
- background Session 常驻；
- 线程级创建、切换和初始化协调。

### 6.3 ConversationSession

```ts
export interface ConversationSession {
  readonly id: string;
  readonly snapshot: HostObservable<ConversationSnapshot>;

  node(key: string): HostObservable<ConversationNode | undefined>;

  readonly actions: ConversationActions;
}
```

`ConversationSnapshot` 只携带节点顺序和会话级状态：

```ts
export interface ConversationSnapshot {
  readonly sessionId: string;
  readonly nodeKeys: readonly string[];
  readonly isLoading: boolean;
  readonly isRunning: boolean;
  readonly hasMore: boolean;
  readonly composer: ComposerSnapshot;
  readonly error?: ConversationError;
}
```

节点内容通过 `session.node(key)` 单独订阅，避免每个 token 都替换完整 message 数组。

### 6.4 Actions

```ts
export interface ConversationActions {
  send(input: ComposerSubmission): Promise<void>;
  cancel(): Promise<void>;
  queue(input: ComposerSubmission): Promise<void>;
  steer(input: ComposerSubmission): Promise<void>;
  retry(nodeKey: string): Promise<void>;
  edit(nodeKey: string, input: ComposerSubmission): Promise<void>;
  fork(nodeKey: string): Promise<string>;
  loadOlder(): Promise<void>;
}
```

只在当前产品确实支持对应行为时公开方法或 capability；不为未来假设添加空实现。

## 7. Conversation 数据模型

### 7.1 不建立通用原始 AgentEvent

Core Contracts 不定义一个覆盖所有 Agent 后端的原始 Event 联合。原因：

- Pi、未来其他 Adapter 的运行事件语义不同；
- 原始事件通常包含实现特有的 turn、step、tool 和恢复信息；
- 强行统一会把 Pi 私有字段重新泄漏到 Core，或形成无法表达真实行为的最低公分母。

每个 Adapter 自己持有原始事件，并输出标准化的 Workbench Conversation Node。

### 7.2 两层投影模型

```text
Conversation
`- ConversationNode[]
   |- UserMessageNode
   |- AssistantMessageNode
   |- SystemNode
   |- CommandNode
   |- CompactionNode
   `- ErrorNode

AssistantMessageNode
`- MessageBlock[]
   |- TextBlock
   |- ReasoningBlock
   |- ToolCallBlock
   |- DataBlock
   |- FileBlock
   |- SourceBlock
   `- ErrorBlock
```

示意：

```ts
export type ConversationNode =
  UserMessageNode | AssistantMessageNode | SystemNode | CommandNode | CompactionNode | ErrorNode;

export type MessageBlock =
  TextBlock | ReasoningBlock | ToolCallBlock | DataBlock | FileBlock | SourceBlock | ErrorBlock;
```

### 7.3 稳定身份

每个 Node 和 Block 必须有稳定 key，不能以当前数组 index 作为身份：

```text
node:  turn:12
block: turn:12:step:2:text:0
tool:  tool:call_abc123
```

具体 key 由 Adapter 根据其可靠身份生成；Core 不假设所有后端都有 Pi 的 seq、turn 或 step。

必须保证：

- 未变化 Node 的对象引用稳定；
- 未变化 Block 的对象引用稳定；
- 只追加文本时，历史 Node 不重建；
- 完成状态可以替换正在流式输出的 Node，但 key 不变；
- history replay 与 live event 为同一业务实体生成相同 key。

## 8. Pi Client 实现

### 8.1 继续复用现有基础

以下能力保留，不重新实现：

- `PiConnectionController`；
- paired `events.mux` / `events.host` WebSocket generation；
- unary RPC client；
- session watermark/revision；
- `SessionMessageAccumulator`；
- Session catalog 和 workspace metadata；
- queue、approval、question、resume、auto-retry 等已有状态；
- Pi Server 的 `AgentSession` 和持久化。

### 8.2 目标内部结构

```text
packages/agent-runtime/adapters/pi/client/src/
|- runtime/
|  |- manager.ts                 # catalog、selection、session cache
|  |- session.ts                 # 单 Session 状态和动作
|  `- session-catalog.ts
|- conversation/
|  |- assembler.ts               # contiguous event window -> nodes
|  |- nodes.ts                   # Pi data -> Workbench Nodes
|  |- partial-tool-call.ts       # partial JSON
|  `- snapshot-builder.ts        # stable node/order snapshots
|- transport/
|  |- connections.ts
|  |- client-transport.ts
|  `- session-message-accumulator.ts
`- public/
   `- ...
```

第一阶段只要求有意义的最小拆分：

```text
manager.ts
session.ts
conversation-assembler.ts
```

只有当 Node Definitions、partial tool parsing 或 snapshot builder 已经形成独立测试和责任时再继续拆文件。

### 8.3 Session 职责

单个 `PiClientSession` 负责：

- 当前加载的连续历史窗口；
- `baseSeq`、tail seq 和 `hasMore`；
- history open/loadOlder；
- live buffer；
- reconnect/resync generation；
- overlap 去重；
- gap detection 和 repair；
- running、queue、pending interaction；
- composer phase 和 prompt error；
- Conversation Assembler；
- immutable snapshot cache；
- per-node observable。

### 8.4 SessionManager 职责

`PiSessionManager` 负责：

- Session catalog；
- current Session；
- lazy Session materialization；
- resident background Sessions；
- WebSocket frame 到已存在 Session 的路由；
- thread/workspace/archived/pinned metadata；
- reconnect 后 catalog refresh 和 resident Session resync；
- new-thread/draft promotion；
- Session 创建、删除和释放。

Manager 不折叠消息内容；Session 不维护全局线程目录。

## 9. 流式输出模型

### 9.1 客户端处理链

```text
WebSocket frame
  -> PiConnectionController
  -> 校验 sessionId / streamId / revision / seq
  -> PiClientSession.accept(...)
  -> 更新 raw event window / transient assistant state
  -> ConversationAssembler
  -> changed node keys + publication priority
  -> Notifier
  -> 对应 Node observers
  -> React ConversationNodeSeat
```

### 9.2 发布优先级

```ts
type ConversationPublication = "microtask" | "animation-frame" | "immediate";
```

- text/reasoning delta：`animation-frame`；
- 普通 catalog、metadata 和非紧急状态：microtask；
- finish、error、approval/question、受控 Composer 输入：`immediate`；
- usage-only 且 UI 不展示的更新：不进入 Conversation 发布链路。

Notifier 必须先重建缓存 snapshot，再通知订阅者，保证 `useSyncExternalStore` 的 snapshot 引用稳定。

### 9.3 历史与实时拼接

目标行为：

1. 首次打开只拉取尾部窗口；
2. 打开期间 live events 进入 buffer；
3. history 到达后按 seq 拼接并去重；
4. 实时 seq 落后或重叠时忽略；
5. 检测到 gap 时保留当前 UI，拉取尾页修复；
6. 用户滚动到顶部时显式 `loadOlder`；
7. prepend 历史时保持视口锚点。

初始窗口和每页大小作为 Pi Adapter 内部常量，只有出现真实配置需求时再公开设置。

### 9.4 服务端 durable chunk 后续阶段

前端 Runtime 迁移初期继续使用现有 Pi `session/message-update` 和 reconnect snapshot，避免同时重写前端、
协议和持久化。

前端切换完成后，可独立评估：

- 为每个 assistant chunk 分配连续 session seq；
- 将 partial text/reasoning/tool args 纳入持久事件日志；
- history 返回未完成生成；
- reconnect 按 seq 重放；
- 对相邻 chunk 打包或压缩；
- 兼容旧 Pi JSONL 会话。

这属于协议和存储迁移，不是删除 assistant-ui 的完成前置条件。

## 10. React 绑定

React 绑定继续位于 `packages/agent-runtime/core/client`。该 package 从 assistant-ui 接入层转为
Workbench Headless Runtime 的 React 接入层。

目标目录：

```text
src/
|- runtime-context.tsx
|- runtime-provider.tsx
|- session-provider.tsx
|- bind-snapshot-selector.ts
|- hooks.ts
|- installation.tsx
`- index.ts
```

Context 只保存稳定 Runtime 对象：

```tsx
const RuntimeContext = createContext<AgentRuntime | null>(null);
```

禁止把完整 `ConversationSnapshot` 放入 Context value；否则每个 token 都会刷新整个 Provider 子树。

建议只公开少量明确 hooks：

```ts
useAgentRuntime()
useThreadList(selector)
useCurrentSession()
useSessionState(selector)
useConversationNode(nodeKey, selector?)
```

不提供类似 `runtime.thread.message(...).part(...)` 的动态 scope DSL。

## 11. Shell 组件架构

聊天 UI 继续位于 `packages/workbench/shell/src/chat`，复用现有 Workbench 组件和
`packages/workbench/shell/src/ui/` 的 Button、Popover、Tooltip、Dropdown、Input 等基础组件。

目标组件树：

```text
WorkbenchThread
|- ThreadHeader
|- ConversationViewport
|  |- ConversationEmpty
|  |- LoadOlderTrigger
|  `- ConversationList
|     `- ConversationNodeSeat
|        |- UserMessage
|        |- AssistantMessage
|        |  `- MessageBlockList
|        |     `- MessageBlockRendererHost
|        |- CommandNode
|        |- CompactionNode
|        `- ErrorNode
|- ScrollToBottom
`- WorkbenchComposer
   |- ComposerAttachments
   |- ComposerInput
   |- ComposerCommands
   |- ComposerQueue
   `- ComposerActions
```

### 11.1 更新粒度

`ConversationList` 只订阅 `snapshot.nodeKeys`，每个 `ConversationNodeSeat` 单独订阅对应 Node：

```tsx
function ConversationNodeSeat({ nodeKey }: { nodeKey: string }) {
  const node = useConversationNode(nodeKey);
  if (!node) return null;
  return <ConversationNodeRenderer node={node} />;
}
```

一个 AssistantNode 的 token 更新不得引起：

- Thread List 重渲染；
- Composer 重渲染；
- 历史 UserMessage 重渲染；
- 其他 AssistantMessage 重渲染；
- RightWorkspace 重渲染。

### 11.2 Composer 状态边界

Session/Runtime 持有：

- 可提交文本内容；
- 附件引用；
- queue/steer mode；
- sending/error phase；
- 每 Session 草稿；
- send/cancel capability。

React 编辑器持有：

- Lexical editor instance；
- selection 和 caret；
- IME composition；
- 临时弹层焦点；
- 非提交型编辑器装饰状态。

不得把完整 Lexical `EditorState` 放入 Session Snapshot。

### 11.3 复用现有视觉实现

`packages/workbench/shell/src/assistant-ui/` 最终删除，但其中不依赖 assistant-ui 的实现应移动而不是重写：

- Markdown renderer；
- Shiki highlighter；
- inline citations；
- file/image display；
- tooltip icon button；
- tool fallback 的视觉部分。

建议归入：

```text
packages/workbench/shell/src/chat/renderers/
```

新增或修改的 UI 继续使用 Shell 共享组件、全局语义 token 和共置的 `en-US`/`zh-CN` 文案。

### 11.4 暂不引入虚拟列表

第一版先使用：

- 有界历史窗口；
- 显式加载更早记录；
- per-node subscription；
- stable key 和结构共享。

只有 profiling 证明长会话 DOM 数量仍是瓶颈时，再评估虚拟列表。虚拟化不得破坏流式滚动、文本选择、
代码块高度变化和 prepend 锚点。

## 12. Extension Platform 迁移

保留现有：

- Extension Manager；
- Registry；
- Slot/Panel/Command/Opener/Settings/Main View/Workspace Surface；
- RendererHost；
- Extension Error Boundary；
- 静态 builtin/installable extension catalog。

替换 Extension SDK 当前公开的 assistant-ui 类型：

```text
ToolCallMessagePart
DataMessagePart
EnrichedPartState
ToolCallMessagePartComponent
DataMessagePartComponent
```

目标 Renderer 层次：

```text
Message Renderer
  -> 接管完整 UserMessageNode / AssistantMessageNode

Block Renderer
  -> 按 kind 或 predicate 接管一个 MessageBlock

Tool/Data Renderer
  -> 按 toolName / dataName 精确匹配
```

示意：

```ts
export interface ToolRendererProps {
  readonly block: ToolCallBlock;
  readonly actions: ToolCallActions;
}
```

约束：

- tool args 在流式阶段必须视为部分输入；
- renderer 覆盖 running、complete、incomplete、requires-action 和 error；
- renderer 只呈现，不因注册自动定义或执行工具；
- Pi 专属 Terminal、Context Trace、Approval 等贡献继续位于
  `packages/agent-runtime/adapters/pi/contributions`；
- Extension SDK 只依赖 Workbench contracts，不依赖 Pi Client。

## 13. assistant-ui 概念映射

| assistant-ui                    | Workbench 目标实现                                          |
| ------------------------------- | ----------------------------------------------------------- |
| `AssistantRuntimeProvider`      | `RuntimeProvider`                                           |
| `useRemoteThreadListRuntime`    | Headless `AgentRuntime` / `SessionManager`                  |
| `useExternalStoreRuntime`       | Adapter 直接实现 `ConversationSession`                      |
| `useAui`                        | `useAgentRuntime` + 稳定 actions                            |
| `useAuiState`                   | `useThreadList` / `useSessionState` / `useConversationNode` |
| `ThreadMessage`                 | `ConversationNode`                                          |
| `MessagePart`                   | `MessageBlock`                                              |
| `messageRepository` branch      | Workbench branch/fork capability                            |
| `ThreadPrimitive`               | `WorkbenchThread` 和普通 React 组件                         |
| `MessagePrimitive`              | `ConversationNodeSeat` / Message components                 |
| `ComposerPrimitive`             | `WorkbenchComposer` + Session composer state                |
| `ActionBarPrimitive`            | Workbench message actions                                   |
| `AttachmentPrimitive`           | Workbench attachment components                             |
| Tool/Data renderer              | Extension Platform Node/Block renderer                      |
| `assistant-stream` title stream | 直接返回 title/result                                       |

## 14. 分阶段实施计划

每个阶段必须保持可构建、可测试、可回滚。文件移动与行为改变尽量不要混在同一个提交中。

### Phase 0：行为基线和依赖清单

工作：

- 固化 assistant-ui 直接依赖和符号使用清单；
- 为关键现有行为补足 characterization tests；
- 记录消息、工具、Composer、线程和重连状态矩阵；
- 明确迁移期间禁止新增 assistant-ui 依赖。

退出条件：

- 已覆盖 text/reasoning/tool streaming、partial tool args、finish/error/cancel；
- 已覆盖 first send、thread switch、background completion、queue/steer；
- 已覆盖 edit/retry/fork、attachment、approval/question；
- 已记录允许临时存在的兼容入口。

### Phase 1：Headless Core 和 Workbench Contracts（已完成，2026-09-02）

工作：

- 新建 `@workbench/agent-runtime-core`；
- 实现 `HostObservable` 和 `Notifier`；
- 定义 Runtime/Session faces；
- 在 contracts 增加 Conversation Node、Block、Snapshot 和 Composer 类型；
- 更新 testkit，提供最小 Fake Runtime。

退出条件：

- Core package 不依赖 React、Pi、Shell 或 assistant-ui；
- snapshot 缓存、microtask/RAF/immediate 发布有小型单元测试；
- Fake Runtime 可以在无 Pi、无 React 环境构造和推进状态。

完成记录：

- 新增 `@workbench/agent-runtime-core`，公开 `HostObservable`、`Notifier`、Runtime/Session faces
  和 Thread Catalog snapshots；
- `@workbench/agent-runtime-contracts/conversation` 已提供 Node、Block、Conversation Snapshot、
  Composer Snapshot 与复用既有 canonical Composer submission 的 actions 输入；
- `@workbench/agent-runtime-testkit/runtime` 已提供无 React、无 Pi 的 Fake Runtime/Fake Session；
- Notifier 的 snapshot cache、microtask、animation frame 和 immediate 发布测试通过；相关 package
  typecheck/test、workspace dependency check、全仓 typecheck 和 Web/Electron build 通过。

### Phase 2：Pi Session 和 Conversation Assembler（进行中，2026-09-02）

工作：

- 从当前大 `manager.ts` 中提取单 Session 状态；
- 建立 history/live 共用的增量 Assembler；
- 生成稳定 Node/Block keys；
- 建立 per-node observable；
- 保留现有 assistant-ui projection 作为临时兼容输出。

退出条件：

- 同一组 history/live 输入产生确定性的 Snapshot；
- overlap、gap、reconnect、partial tool JSON 有测试；
- 单个 delta 不改变无关 Node 引用；
- assistant-ui 和新 Snapshot 来自同一 PiClientSession。

执行切片：

| 切片 | 状态                 | 变更范围                                                                                                                   | 最小验证                                                                          |
| ---- | -------------------- | -------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| 2A   | 已完成（2026-09-02） | 接入 session-owned `PiConversationAssembler`；稳定 Node/Block key、结构共享、per-node observable 和同一 Session 双投影     | Pi Client 277 项测试、package typecheck、workspace dependency                     |
| 2B   | 已完成（2026-09-02） | 将 `PiClientSession` 和仅属于 Session 的 helper 物理移动到 `runtime/session.ts`；`manager.ts` 只保留目录、选择、缓存和路由 | 兼容导出不变；Pi Client 277 项测试和 package typecheck 通过                       |
| 2C   | 已完成（2026-09-03） | 让 Assembler 直接消费 Pi-owned canonical history/live state；assistant-ui 改为同源的下游兼容投影；接入发布优先级           | Pi Client 279 项测试；覆盖 history/live、reconnect、partial args 和 Node 定向通知 |
| 2D   | 待开始               | 对照本阶段退出条件收口，更新 Pi Client 架构说明并删除本阶段已失效的临时路径                                                | package typecheck/test、workspace dependency；按边界决定 build                    |

2A 暂时以 assistant-ui projection 作为 Assembler 输入，这是避免第二个事件 reducer 的迁移边界；
2B 通过 `manager.ts` 的兼容 re-export 保持现有调用方不变，并仅使用 type-only 的 Session → Manager 引用，
不形成运行时循环。2C 已将 history、live 和 optimistic 共用的归一化消息形态收归
`PiConversationMessage`，Assembler 直接消费该状态并生成 Workbench Node；assistant-ui 只从同一状态
获取零拷贝兼容投影。普通 history/metadata 使用 microtask，流式 delta 复用 Session 既有 RAF 合帧，
finish/error 等终态立即发布，且 immediate 更新会抢占待发布的低优先级通知。Phase 2 保持“进行中”，
下一步只执行 2D 收口；Phase 3 Provider 和 UI 迁移不混入本阶段。

### Phase 3：React Provider 和 Selector Hooks

工作：

- 用 `RuntimeProvider` 替代新的上层安装入口；
- 增加 `SessionProvider` 和 selector hooks；
- 保持现有 route/new-thread integration；
- 让新旧 UI 可以在同一个 Runtime 对象上逐块切换。

退出条件：

- Context value 在 token streaming 时引用稳定；
- selector 只在选中值变化时渲染；
- Session 切换按稳定 session id remount 所需子树；
- 不产生第二个连接或第二个 SessionManager。

### Phase 4：Conversation 与 Message UI

工作：

- 替换 Thread/Message/Part primitives；
- 实现 ConversationList、NodeSeat 和 Block renderers；
- 迁移 Markdown、reasoning、tool timeline、source、file、image 和 error；
- 保持 scroll-to-bottom、用户滚动锁定和 prepend 锚点。

退出条件：

- 消息区域不再使用 assistant-ui hooks/primitives；
- token 更新只刷新活动 Node；
- 流式 Markdown、代码块和工具状态与旧 UI 行为一致；
- 键盘、复制、选择、ARIA 和错误展示保持可用。

### Phase 5：Composer、附件和消息 Actions

工作：

- 替换 ComposerPrimitive 和 assistant-ui composer scope；
- 迁移 send/cancel/queue/steer；
- 迁移附件添加、删除、粘贴和能力校验；
- 迁移 edit/retry/copy/fork/feedback/quote；
- 保留 Composer Commands 和 mentions。

退出条件：

- Composer 不依赖 assistant-ui；
- IME、受控输入、附件和首次发送行为稳定；
- 拒绝发送、网络错误和恢复路径不丢失草稿；
- Actions 使用 Session 稳定方法，不直接操作 transport。

### Phase 6：Thread List、Current Session 和路由

工作：

- 替换 `RemoteThreadListAdapter` 和 ThreadList primitives；
- 迁移 create/switch/rename/archive/unarchive/delete；
- 迁移 workspace 分组、pin、排序、后台运行和未读完成；
- 迁移 draft/new-thread promotion 和 route-selected session；
- 显式实现 loadOlder 入口。

退出条件：

- Thread List 和当前 Session 不再依赖 assistant-ui；
- 后台线程继续接收运行、审批和完成事件；
- 切换线程不重复创建 Session/连接；
- URL、桌面恢复和首次发送流程与基线一致。

### Phase 7：Extension SDK、Host 和 Pi Contributions

工作：

- 将 Renderer contracts 改为 Workbench Node/Block；
- 更新 RendererHost；
- 迁移所有 Shell builtin renderers；
- 迁移 Pi Terminal、Context Trace、Image Understanding、Interaction 等 contributions；
- 更新 Toolbox renderer previews 和 test fixtures。

退出条件：

- `extension-sdk` 和 `extension-host` 不再依赖 assistant-ui；
- 所有工具状态和部分参数仍可渲染；
- 一个 extension 的卸载不会破坏默认 Message/Block fallback；
- Pi contribution 只使用 Pi Client 的 public capability。

### Phase 8：删除兼容层和依赖

工作：

- 删除 Pi assistant-ui projection；
- 删除 `packages/workbench/shell/src/assistant-ui/` 中剩余 wrapper；
- 删除 assistant-ui testkit 和兼容测试；
- 移除所有 package manifest 依赖；
- 删除 `.agents/skills/` 下专用于 assistant-ui 的九个技能目录（已完成）；
- 更新保留的 Workbench/Pi skills，移除其中已经失效的 assistant-ui 路由说明（已完成）；
- 更新 README、架构图和 package boundary checks。

退出条件：

```bash
rg '@assistant-ui|assistant-stream|useAui|AssistantRuntime' apps packages
```

除明确保留的历史文档或迁移记录外结果为零，并满足：

- pnpm lockfile 中无直接 assistant-ui 依赖；
- Web/Electron 构建产物中无 assistant-ui package；
- 所有 public exports 不含 assistant-ui 类型；
- 旧 compatibility adapter 已删除而不是永久 deprecated。
- `.agents/skills/` 不再包含 assistant-ui 专属技能，保留的 Workbench/Pi skills 不再把任务路由到它们。

### Phase 9：可选的 durable chunk 协议

Phase 8 完成后单独立项，不作为 UI Runtime 迁移的阻塞条件。

## 15. 迁移期间的规则

1. 新功能不得继续建立在 assistant-ui API 上；必要修复可以修改旧路径，但不得扩大其 public surface。
2. 任一时刻只有一个 PiSessionManager、一个 PiClientSession/session 和一组 WebSocket connections。
3. 兼容层只能从新事实源向旧 UI 单向投影，禁止旧 UI 状态反向成为权威状态。
4. 每完成一个 UI vertical slice，立即删除该 slice 的 assistant-ui 调用，不保留备用实现。
5. Core Runtime 不复制 Pi RPC 类型；Pi Client 不深层导出 transport internals。
6. Shell 继续复用共享 UI 组件和语义 token，不趁迁移复制 Button、Popover、Tooltip 或 Dropdown。
7. 所有新用户可见文案同时提供 `en-US` 和 `zh-CN`。
8. 若复制或改编 DSH 的具体 MIT 源码，记录来源并保留相应版权/许可证要求。
9. 不使用 Big Bang 切换；但也不允许长期维护新旧两套 Runtime。

## 16. 验证策略

### 16.1 Headless 单元测试

重点验证输入事件序列和输出 Snapshot：

- history only；
- live only；
- history + buffered live；
- overlap；
- revision gap；
- reconnect snapshot；
- text/reasoning delta；
- tool args partial JSON；
- tool result/error；
- cancel/interrupted/resume；
- prepend older history；
- stable Node/Block identity。

### 16.2 React 组件测试

- selector 隔离；
- Session keyed remount；
- Composer controlled input 和 IME；
- scroll-to-bottom 和 prepend anchor；
- tool requires-action；
- thread switch/new-thread promotion；
- extension renderer fallback/error isolation。

### 16.3 每阶段最低检查

按改动 package 运行：

```bash
pnpm --filter <package> typecheck
pnpm --filter <package> test
pnpm exec oxlint <changed-paths>
pnpm exec oxfmt --check <changed-paths>
```

Provider composition、public contract 或 client/server boundary 改动完成后运行：

```bash
pnpm typecheck
pnpm check:workspace-dependencies
pnpm build
```

全迁移收口运行：

```bash
pnpm check
pnpm build
```

Browser/E2E 只用于静态和组件测试无法确认的高风险交互，例如流式滚动、IME、线程切换中的状态同步、
附件拖放和 reconnect 可见行为。

## 17. 主要风险与控制

| 风险                              | 后果                         | 控制                                           |
| --------------------------------- | ---------------------------- | ---------------------------------------------- |
| 新旧 Runtime 双写                 | 消息顺序、运行状态和草稿漂移 | 单一 PiClientSession，兼容层只读投影           |
| 每个 delta 重建全量节点           | 长会话卡顿                   | stable key、结构共享、per-node observable      |
| Context 携带动态 snapshot         | 整棵 UI 每 token 重渲染      | Context 只放稳定 Runtime 对象                  |
| partial tool args 被当作完整 JSON | 流式工具 UI 崩溃             | 独立增量 parser，renderer 容忍部分字段         |
| history/live 拼接丢事件           | 消息缺失或重复               | seq/revision 去重、buffer、gap repair 测试     |
| Composer 状态全部进入 Runtime     | IME/光标问题                 | 提交状态与编辑器临时状态分离                   |
| 扩展 SDK 一次性破坏               | 所有 Pi renderers 失效       | 新旧 renderer props 短期并行，逐贡献迁移       |
| 过早拆分大量 packages             | 循环依赖和构建负担           | 只新增 Headless Core，一个真实边界一个 package |
| 复制 DSH 整套框架                 | Cordis、React、协议耦合      | 只借鉴算法和对象模型，使用 Workbench contracts |
| 同时修改服务端持久化              | 故障定位和回滚困难           | durable chunk 单独 Phase 9                     |

## 18. 第一批交付范围（已完成，2026-09-02）

第一批只完成 Runtime 地基，不改用户界面：

当前进度：1–4 已随 Phase 1 完成，5–7 已随 Phase 2 的 2A 切片完成；Session 物理提取已随 2B
完成，canonical state 和发布优先级已随 2C 完成，后续只执行 Phase 2 的 2D 收口。

1. 新建 `packages/agent-runtime/core/runtime`；
2. 定义最小 `HostObservable`、`Notifier`、`AgentRuntime` 和 `ConversationSession`；
3. 在 `core/contracts` 增加最小 Conversation Node/Block/Snapshot 类型；
4. 为 `core/testkit` 增加 Fake Session；
5. 让现有 `PiClientSession` 产生 Workbench ConversationSnapshot；
6. 保留 assistant-ui projection，使现有 UI 继续工作；
7. 添加 history/live、streaming 和 stable identity 的小型测试。

明确跳过：

- 不迁 UI；
- 不改 WebSocket；
- 不改 Pi Server；
- 不改持久化；
- 不增加虚拟列表；
- 不创建 `chat-ui` package；
- 不移除 assistant-ui dependency。

以上跳过项继续保持边界；只有对应后续 Phase 开始后才进入 vertical slices。

## 19. 完成定义

本计划完成时必须同时满足：

1. Workbench 自有 Runtime 是唯一浏览器会话状态模型；
2. Pi Client 是 Pi 原始事件到 Workbench Snapshot 的唯一投影边界；
3. Thread List、Conversation、Message、Composer 和 Actions 全部使用 Workbench API；
4. Extension SDK/Host 不公开 assistant-ui 类型；
5. 所有 Pi contributions 已迁移；
6. assistant-ui 直接依赖、源码 imports、compatibility adapters 和 UI wrappers 全部删除；
7. 现有用户可见聊天能力通过对应的自动化或针对性验证；
8. package dependency boundary、Web build 和 Electron build 通过；
9. 文档和架构图反映新 Runtime，不再把 assistant-ui 标为浏览器状态所有者；
10. durable chunk 若尚未实施，被明确记录为独立后续项目，而不是隐藏在兼容层中；
11. assistant-ui 专属 Agent skills 已删除，保留 skills 中不存在指向已删除技能的路由。
