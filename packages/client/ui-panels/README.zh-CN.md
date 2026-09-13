# @workbench/ui-panels

[English](README.md)

Workbench 面板布局、Dock 外框、尺寸调整，以及底部终端抽屉包装。

`src/` 拥有面板组件和双语翻译 bundle。`lib/panel-dimensions.ts` 存放由 `src/panel-container.tsx` 实际消费的面板尺寸计算。测试放在 `tests/`，并在不渲染 UI 的前提下约束包边界。

公开入口：

- `@workbench/ui-panels` 导出 `PanelLayout`、`PanelDock`、`TerminalDrawer`、面板构建组件及其公开 props 类型。
- `@workbench/ui-panels/i18n` 导出 `panelsTranslationBundle`。

本包消费 Extension Host 的面板服务和 Host 组件，不依赖 Shell 或 terminal UI；`TerminalDrawer` 只选择底部 Panel Dock，不拥有终端生命周期。

```bash
pnpm --filter @workbench/ui-panels typecheck
```
