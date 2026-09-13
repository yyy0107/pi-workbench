# 边界研究

## 两种列表

Decision：ui-conversation-list 指侧栏会话导航；ui-conversation-messages 指聊天消息流。
Rationale：前者订阅 thread catalog/工作区分组与 order store，后者订阅当前 session 的 nodeKeys、日期、轮次及滚动。用户同时要求会话目录和对话列表细拆，两者都纳入。
Alternatives：合并会把导航和消息渲染状态混在一起；只迁 thread-list.tsx 会回引 workspace-sidebar-context。

## 会话节点

Decision：ui-conversation-nodes 拥有节点 UI 装配与 Context，运行时定义仍在 agent-runtime-contracts/conversation。
Rationale：现成 ConversationNode union 和 useConversationNode/useConversationNodes 已承担参考中的节点注册/订阅职责。复制 chat-snapshot-builder 或新 stores 会制造双状态。
Alternatives：不新建第二套 node protocol 或 conversation service，不为参考文件名新增功能。

## 无环关键切口

Decision：ConversationNodeSeat 从 list 拆到 nodes；steered-turn 的完整 Context/组件/辅助同属 nodes；composer-message-text 的上下文 wrapper 留 nodes，Content 搬 blocks。
Rationale：workbench-message 读取 steered-turn，message-parts 读取 message Context，不能将这些 Context 按文件名分散。blocks 可以依赖公共 runtime hook（例如 managed attachment 读取），无需为了纯展示而重写所有状态接口。
Alternatives：Context 放顶层 ui-conversation 会导致 blocks/nodes 回引；每包复制 Context 会让 Provider 失效。

## 侧栏完整业务迁移

Decision：workspace section/controller、分组/排序/pin/move、业务扩展整体迁 list；ui-sidebar 只保留 primitives/pointer reorder/generic move。
Rationale：业务 controller 当前统一管理目录和会话，先保留一个完整控制器才能保持跨组拖放事务。Shell 直接安装新 list 扩展，因此 generic sidebar 不回引业务。
Alternatives：把 ui-sidebar shell 保留业务 extension 并导入 list 会在 list 复用 primitives 时成环。

## 命名与参考结构

Decision：ui-composer、ui-conversation、ui-conversation-list、ui-conversation-messages、ui-conversation-nodes、ui-message-blocks。
Rationale：沿用已确认 ui-*、目录与包名一致；源树按现有 shallow src/lib 规范。
Alternatives：不使用拼错的 ui-comversation，不复制 src/client/chat 深层目录，不引入 README.i18n.yaml 或 tsdown。
