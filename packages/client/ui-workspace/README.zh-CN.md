# 工作区界面

负责右侧工作区的 React 安装适配、Hooks、Surface 宿主、工作区标签页、反馈表单、缩放行为、呈现样式和翻译。根入口提供呈现几何能力，`/react` 提供 Provider 与 Hooks，`/presentation` 提供共享视图，`/i18n` 提供翻译 bundle，`/styles.css` 提供 Shell 样式。

本包消费唯一的无界面 `@workbench/workspace-runtime` 安装实例。React 管理 Strict Effects 时序和呈现资源；runtime 安装实例仍是 controller、状态、草稿和反馈的唯一所有者，并统一销毁这些资源。

源码职责：`src/` 负责 React 装配和呈现，`lib/` 保存呈现专用的纯计算，`tests/` 保存既有界面相关测试。本轮包边界重构不运行 UI、DOM、Hook 渲染或浏览器测试。
