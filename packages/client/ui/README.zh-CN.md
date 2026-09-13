# @workbench/ui

基础控件、语义 token、Portal、剪贴板、键盘归属与通用 Hook。富选择器归 ui-selectors，尺寸调整归 ui-resize，展开滚动归 ui-disclosure；侧栏、模型与颜色选择分别归 ui-sidebar、ui-agent-controls、ui-settings。基础包不生产依赖这些能力包。

公开入口在 package.json 中明确列出。UI 文案使用已安装的 uiTranslationBundle。Shell 按原有层叠顺序聚合组件样式与全局 token；弹层保持所属 Portal，复用密度、圆角与颜色配置。

src/ 放真实控件实现及共置词典/样式，lib/ 放被消费的剪贴板、键盘归属与类名辅助，tests/ 保留既有测试。两处源码均为浅层 TS/TSX。示例：src/components/avatar.tsx → lib/utils.ts。Spec 003 按用户约束排除 UI 测试执行。
