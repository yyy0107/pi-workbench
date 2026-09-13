# 数据与状态所有权

本次没有新协议或存储模型。

- ConversationNode / MessageBlock：agent-runtime-contracts 的既有判别联合；key、kind、createdAt、blocks、presentation/custom、status 原样消费，不复制定义。
- Session snapshot：agent-runtime-client 唯一 session/provider 和 node selector；nodeKeys 顺序与 selector equality 保持。
- Message context：nodes 唯一 messageId/role/isLast/index 与 structure Context。消息流在原位置调用相同 Provider，块 renderer 不向上读取 Context。
- Turn presentation：nodes 内 steered-turn open/running/finalMessageId 及 completed-turn helper；保活、折叠及 effect 清理保持。
- Viewport：messages owns scroll snapshot/restore、anchor 与补偿；SessionProvider/导航路由在 ui-conversation。
- Thread catalog/order：ui-conversation-list 消费原 runtime thread catalog，拥有现有 order store/controller，保持 pin、workspace、move/persistence revision 语义。
- Composer document：ui-composer 原 editor/history/submission 状态；blocks 只读取持久化文档用于显示，不创建输入状态。
- Bundle/style：每个 capability 唯一字典；主题/密度/圆角和 Portal 区域保持。

所有状态转移沿原实现：streaming→completed/error、retry、steering、草稿→持久会话与拖放提交，不改变时序或失败处理。
