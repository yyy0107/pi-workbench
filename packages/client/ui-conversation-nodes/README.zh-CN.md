# @workbench/ui-conversation-nodes

负责会话节点选择与呈现、消息与转向轮次 Context、消息操作与内容部分、已完成轮次呈现及消息呈现扩展。`src/` 包含公开 React 能力，`lib/` 包含实际使用的呈现策略和纯辅助逻辑。该包通过公开入口消费消息块，且不依赖消息列表 owner。

节点适配器负责 Session 到视图的投影及命令文档解析；./styles.css 负责消息操作和用户消息入场动画。
