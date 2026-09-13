# 公共契约与依赖

主方向：ui-conversation → ui-conversation-messages → ui-conversation-nodes → ui-message-blocks；ui-conversation 与 blocks 可消费 ui-composer（文档/token）；ui-composer → 已有 ui-attachment/ui-input-trigger。ui-conversation-list → ui-sidebar primitives + runtime/navigation；Shell 直接安装 list，不允许 ui-sidebar → list。

1. ui-composer 保持现有可用子入口语义与组件 props，替换目录/package 前缀。
2. messages 公开列表及 scroll-state/viewport/rows；nodes 公开 NodeSeat、message Context、SteeredTurn、message presentation extension；blocks 公开块 renderer 和 terminal/error/text 等真实组件，package export target 只指向 src。
3. NodeSeat 的节点选择/role/fallback/Provider 包裹由 nodes 统一拥有；消息流只传 index/nodeKey 等已有参数，不复制 switch 或 Context。
4. composer-message-text 的节点 wrapper 与 Content 分离：wrapper 读取 document 后调用 blocks 的 Content；文本/文档/role/streaming 均使用现有形状，不发明新运行时协议。
5. Sidebar 泛型 reorder 类型与 helper 从 ui-sidebar 的 src 公开；list 完整迁业务 controller，不拆出第二套拖放 session 或 order store。
6. shell 的 workbench.workspace-sidebar、workbench.message-presentation 等 ID 和安装/返回清理顺序稳定；现有 consumers 分类更新，旧大包不保留跨能力兼容转发。
7. CSS 必须枚举实际加载路径和选择器冲突；共享区域样式公开聚合，独占资源随能力，不能叶包回引顶层 bundle。
8. 所有测试来源目标登记，不新增或运行 UI 测试。完成公共类型/结构/依赖及允许验证后才关闭任务。
