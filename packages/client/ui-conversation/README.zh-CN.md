# @workbench/ui-conversation

负责顶层会话路由与 session 装配：`WorkbenchConversation`、`WorkbenchThread`、空状态、会话标题、session wiring，以及各公开会话能力包的最终组合。消息列表、节点展示、消息块、Composer 编辑器和侧栏导航分别归各自 owner。

`src/` 放路由/session 组件、空状态、标题辅助、本地词典和样式；`lib/` 放实际使用的 `workbench-thread-timing` 辅助模块。公开消费者使用根入口、`./title`、`./i18n` 和 `./styles.css`；功能 owner 通过公开契约组合。

本包保持 session identity、路由同步、安装顺序和资源释放行为，不应引用 composer、conversation-list、conversation-messages、conversation-nodes 或 message-blocks 的私有源码。

Composer dock 动画位于 conversation-dock.css，与拥有 dock DOM 的组件共置。
