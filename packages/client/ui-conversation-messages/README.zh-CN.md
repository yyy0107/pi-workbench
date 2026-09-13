# @workbench/ui-conversation-messages

负责有序消息流、日期分组、消息配对、布局、视口补偿及阅读位置持久化。`src/` 包含列表与滚动契约，`lib/` 包含实际使用的行选择器和视口算法。节点渲染委托给 `@workbench/ui-conversation-nodes`。

样式入口装配节点样式并只拥有消息列表容器 token；dock、消息操作和 Markdown/代码标题栏样式归实际组件。
