# @workbench/ui-layout

[English](README.md)

Workbench 框架、标题栏、侧栏外框、全局层、状态栏、响应式布局生命周期，以及品牌切换扩展。

`src/` 拥有可见框架及其双语 `workbench.shell` 翻译 bundle。`lib/` 包含由 `WorkbenchShell` 实际消费的布局动画和原生窗口尺寸观察器。既有 UI 测试保留在 `tests/`；根据当前迁移约束，不执行这些测试。

公开入口：

- `@workbench/ui-layout` 导出 `WorkbenchShell` 及其公开 props 类型。
- `@workbench/ui-layout/extension` 导出 `workbenchBrandExtension`。
- `@workbench/ui-layout/i18n` 导出 `layoutTranslationBundle`。
- `@workbench/ui-layout/statusbar` 导出 `WorkbenchStatusbar`。
- `@workbench/ui-layout/styles.css` 提供限定作用域的框架布局和动画样式。

本包通过公开包消费侧栏和面板能力，不依赖 Shell 或 Pi product 装配。

```bash
pnpm --filter @workbench/ui-layout typecheck
```
