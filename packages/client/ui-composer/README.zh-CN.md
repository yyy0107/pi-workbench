# @workbench/ui-composer

负责富文本输入编辑器及其 document、历史、Token、Markdown、提交和 Composer surface 代码。附件 UI 与命令触发/参数能力由独立 owner 负责；`@workbench/ui-conversation` 装配会话 surface，`@workbench/ui-message-blocks` 在消息中渲染无状态的 Composer 文档内容。

`src/` 放编辑器、提交流程、契约、词典和样式；`lib/` 放实际使用的输入历史、Markdown 检测、面板样式和 Pi 兼容辅助模块。测试位于 `tests/`，源码和辅助统一保留 TypeScript/TSX，最多一级子目录。

消费者使用公开的 `./document`、`./directives`、`./tokens`、`./panels`、`./i18n` 和 CSS 入口。通过能力边界传入附件、命令和提交回调，不要创建第二套编辑器状态，也不要引用其他能力的私有源码。

编辑器插件、建议、提及、命令参数、附件恢复和提交由独立源码模块负责，保持原编辑器与 Session 生命周期；共享 token 从 ui-input-trigger/tokens 引入。
