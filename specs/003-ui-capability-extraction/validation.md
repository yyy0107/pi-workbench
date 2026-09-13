# Spec 003 实施验收

基线：8d4b6568；分支：codex/package-refactor。用户在计划后授权实施。主 Agent 负责共享集成，GPT-5.6 Luna 负责 selectors/model，GPT-5.6 Sol 负责 resize/disclosure/sidebar 并独立静态复核。未提交或推送。

## 迁移证据

- 清单 100/100 个目标存在；35/35 个整文件完成移动且旧来源消失。
- 原 ui 的 20/20 个测试文件均在声明目标；全仓仍为 535 个测试文件，没有删除既有测试。
- 实际 75 个库包，目录/包名一致，src/lib 保持真实职责和浅层 TS/TSX。
- 基础 ui 删除迁出的导出及旧 resize/disclosure/proportional CSS subpath，没有对新 owner 的生产回引；保留 shared-foundations 用例仅增加 ui-selectors devDependency。
- Sidebar/resize/disclosure 静态对比原文件，除导入和导出路径外主体保持：原 Context/WeakMap、事件字符串、Portal、pointer/keyboard、Observer/RAF 清理和阈值不变。
- 三份迁移 CSS 与基线逐字节一致；Shell 保持 sidebar → control-icons → color-picker 的层叠顺序，tokens 仍最后。比例样式仍在 ui-layout 原导入位置。
- ColorPicker 使用唯一共享 useI18n(settingsUiTranslationBundle)，ui.colorPicker 七个语义键及双语值/插值原样迁移，ui bundle 删除原子树，两 bundle ID 保持。
- 删除仅因迁移产生的空目录；历史 Spec 001/002 未改动。

## 本轮检查

| 检查                                                            | 结果                                         | 证据                                                               |
| --------------------------------------------------------------- | -------------------------------------------- | ------------------------------------------------------------------ |
| pnpm install --ignore-scripts；frozen-lockfile --ignore-scripts | PASS                                         | /tmp/spec003-install.log、/tmp/spec003-frozen.log                  |
| 生产 workspace 依赖、runtime host 所有权                        | PASS                                         | check-workspace-dependencies.mjs、check-runtime-host-ownership.mjs |
| 包结构                                                          | PASS                                         | 75 libraries, 535 test files, 0 tracked migration violations       |
| 精确非 UI 逻辑用例                                              | PASS，15 项                                  | /tmp/spec003-logic.log                                             |
| 扩展源码边界检查                                                | PASS，13 项                                  | /tmp/spec003-boundaries.log                                        |
| pnpm lint                                                       | PASS                                         | /tmp/spec003-lint.log                                              |
| pnpm typecheck                                                  | PASS，全仓 apps/packages                     | /tmp/spec003-typecheck.log                                         |
| pnpm build                                                      | PASS，Runtime/Web/Desktop/Electron artifacts | /tmp/spec003-build.log                                             |

选定逻辑入口仅为 resize-spring、disclosure-scroll-policy、model-selector-models、normalizeHexColor 和 proportional-panel-size。没有执行混合 test/check。

## UI 排除范围

所有 UI/React/DOM/fake DOM/交互/视觉测试、Browser/Electron 自动化和手工冒烟均 excluded-by-user。既有测试只迁移、修正导入并通过类型检查，不能把源码静态等价或构建成功表述为 UI 行为已实测。尤其 observe-resize-handle 和 use-collapsible-resize 的 .test.ts 仍属于排除范围。

## 实施修正

集成时类型检查发现 ui-sidebar 既有测试及类型模块残留旧 ui 导入，并发现 ui-agent-controls 需要声明 ui-disclosure；均已修正后重新通过全仓类型检查，没有恢复兼容转发或放宽守卫。ui-agent-controls 已有 src/models.ts，因此扩充现有入口并保留原状态 helper exports。Sidebar reorder 直接公开真实 Hook 文件，没有保留多余转发 barrel。

构建成功退出（0）。Web 与 Desktop 各有既有 `::highlight(pi-prompt-placeholder)` 的 Turbopack CSS 解析 warning；未修改无关 Pi 样式。最终 git diff --check 通过。
