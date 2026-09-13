# @workbench/ui-message-blocks

负责可复用的会话块渲染器：文本、文件、图片、来源、工具/数据块、命令响应、错误、流式文本、终端输出和会话分隔符。本包也负责消息块中使用的无状态 Composer 文档内容渲染；读取节点 Context 的 wrapper 仍归 conversation nodes。

`src/` 放渲染器、契约、样式和公开入口；`lib/` 放实际使用的块数据辅助模块。各渲染器通过公开子路径提供，并保持既有运行时 props、标识符和 i18n 键稳定。

消息视图接收已投影的文档、附件 reader 与重试状态/动作；Session 和命令注册表查询归 ui-conversation-nodes。./styles.css 提供所属图片、token 与消息样式。
