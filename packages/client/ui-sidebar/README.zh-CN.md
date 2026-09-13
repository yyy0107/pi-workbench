# @workbench/ui-sidebar

负责通用侧栏 Provider、行与分组组件、指针拖放 session 和区域样式。会话导航归 ui-conversation-list，通过公开 primitives/reorder/order 入口复用。src/sidebar-reorder.ts 公开并消费 lib/sidebar-reorder.ts 的真实通用算法。测试位于包根。
