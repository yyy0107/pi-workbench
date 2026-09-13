# @workbench/ui

Shared primitive controls, semantic tokens, Portal ownership, clipboard, keyboard ownership and general hooks. Rich selectors live in `@workbench/ui-selectors`; resize and disclosure live in `@workbench/ui-resize` and `@workbench/ui-disclosure`. Sidebar primitives, model selection and color selection belong to ui-sidebar, ui-agent-controls and ui-settings respectively. This foundation has no production dependency on those capabilities.

基础 UI 包提供控件、语义 token、Portal、剪贴板、键盘归属与通用 Hook。富选择器、尺寸调整、展开滚动、侧栏、模型和颜色选择由各自能力包公开；基础包不反向依赖它们。产品文案使用 `@workbench/ui/i18n` 的已安装 bundle。

Shell assembles capability CSS and global tokens in the original cascade order. Keep overlays in WorkbenchPortalContainerProvider and use existing density, radius and color tokens. Shell 按原顺序聚合各能力 CSS；弹层保持所属 Portal、区域标记与全局外观配置。

Source roles: src/ owns real primitive implementation and dictionaries/styles; lib/ contains consumed clipboard, keyboard and class-name helpers. Both source roots remain shallow TypeScript. tests/ preserves existing coverage; UI tests are excluded by user for Spec 003.

源码职责：src 为真实控件实现及共置资源，lib 为被消费的内部辅助，均保留浅层 TS/TSX。示例：src/components/avatar.tsx → lib/utils.ts。
