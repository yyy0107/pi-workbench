# @workbench/conversation

负责消息渲染、滚动、消息操作、队列、交互请求、侧聊和归档。src 放组件、契约、扩展装配及词典/样式；lib 放组件使用的投影、布局和策略辅助模块，统一保留 TS/TSX。测试归 tests，保留扩展 ID 与安装顺序。

源码分工：src 承载本包能力与契约，lib 仅放实际使用的内部辅助，tests 为包根测试。实际消费者示例：`src/archived-chats/archived-chats-settings-item.tsx` 引用 `lib/archived-chats/archived-chat-group-a11y.ts`。实现保留 TS/TSX；既有构建工具保持原语言。
