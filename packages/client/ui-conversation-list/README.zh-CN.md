# @workbench/ui-conversation-list

负责侧栏会话目录、工作区分组、切换、置顶、顺序持久化、移动与菜单。Shell 安装原工作区侧栏扩展；通用控件与拖放 session 复用 ui-sidebar。src 为实际能力，lib/thread-sort.ts 由 sidebar-projection 消费；词典共置，既有测试位于包根。

sidebar-context 要求通过显式 selector 消费 sidebar-contracts；controller 负责运行时协调，lib/sidebar-projection 生成视图数据，移动菜单独立于唯一 store。
