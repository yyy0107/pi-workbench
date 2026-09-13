# Package Map: 从 UI 提取能力

所有目标均为规划；完整整文件来源/去向见 [migration-inventory.json](migration-inventory.json)。以下路径省略公共前缀 `packages/client/`。

## 新包与真实辅助

| Owner / 公开入口                 | src 来源                                                                                                                 | lib 来源 / 实际消费者                                                                                                                                         | 测试与直接消费者                                                                                                                                         |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ui-selectors`：`.`              | ui/components 的 searchable-selector、selector-dropdown、workspace-selector → 平铺 src；index 输出现有 props/types/hooks | 从 selector-dropdown 现有实现提取 CSS 时间和过渡时长计算至 lib/selector-dropdown-metrics.ts；同包 selector-dropdown.tsx 实际消费。DOM 观测和状态仍为 src 能力 | selector-dropdown/workspace-selector 既有 UI 测试迁移不运行；workspace-browser/git-branch/directory-picker、automation、Pi toolbox、模型视图改用公开入口 |
| `ui-resize`：`.`、`./styles.css` | resize 两 hooks、CollapsibleResizeHandle、barrel、比例 CSS                                                               | spring、observe-resize-handle、proportional-panel-size 三文件平铺 lib；hooks/handle 直接消费                                                                  | 三 resize 测试完整迁移，仅 spring 数值测试允许执行；ui-layout/workspace-runtime、Shell 比例断言同步                                                      |
| `ui-disclosure`：`.`             | disclosure 三实现和 barrel                                                                                               | disclosure-scroll-policy → lib，scroll-lock/details 和公开查询实际使用                                                                                        | policy.test 可执行；scroll-lock.test.tsx 迁移排除；conversation、code-highlighting、ui-agent-controls 同步                                               |

新包预期生产依赖：selectors → ui、Base UI、lucide；resize → ui（handle utils）、React；disclosure → React。React/DOM 类型和 peer/dev 声明按现有实际使用保留。不移走仍被基础 UI 使用的 Base UI/cmdk/lucide。

## 已有 owner 扩充

| Owner             | 来源 → 目标                                                                                                                                                                           | 新入口 / 消费者                                                                                                                                                                                                               |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ui-agent-controls | ui/src/components/model-selector.tsx → src/model-selector-view.tsx；ui/lib/components/model-selector-models.ts → lib/model-selector-models.ts                                         | `./selector` 导出视图与 props；`./models` 通过 src/models.ts 输出模型类型和 filter helper；已有业务 model-selector.tsx 与 lib/model-selector-state.ts 改本地引用；automation 的类型引用使用 ./models。视图依赖 ui-selectors   |
| ui-settings       | ui/src/components/color-picker.tsx → src/color-picker.tsx；normalizeHexColor → lib/normalize-hex-color.ts；color-picker.css → src/color-picker.css                                    | `./color-picker` 保留组件及原 normalize API；`./color-picker.css` 独立导出便于保持全局顺序。appearance-settings-item 为生产消费者；已有 color-picker.test.ts 移入本包并直接测纯 helper                                        |
| ui-sidebar        | ui/src/components/sidebar.tsx → src/sidebar-primitives.tsx；sidebar-items.tsx → src/sidebar-items.tsx；use-sidebar-pointer-reorder.tsx → 同名 src；sidebar-items.css → src/styles.css | `./primitives` 通过 src/primitives.ts 导出 SidebarProvider/useSidebar/各 Sidebar/Row 组件；`./reorder` 导出 pointer Hook 与 types；`./styles.css`。ui-layout/ui-settings/automation/Pi toolbox 改入口，内部线程列表改本地引用 |

迁移 ModelSelector/SidebarItems 的既有 tests，不覆盖已有同名业务文件。模型视图测试目标为 model-selector-view.test.tsx；helper test 为 model-selector-models.test.ts。sidebar test 为 sidebar-items.test.tsx。

## 基础包保留与收窄

ui 保留 primitives、Portal、tokens、control-icons/menu styles、通用 utilities/hooks/clipboard/keyboard/disclosure 以外的基础入口。具体 retained 文件可从 inventory 查询，未列入迁移不自动搬迁。

- 删除 root/components barrels 中迁出的 SearchableSelector/SelectorDropdown/WorkspaceSelector/ModelSelector/ColorPicker/Sidebar/SidebarItems/CollapsibleResizeHandle 及相关 types/helper 转发。
- 删除 `./resize`、`./disclosure`、`./proportional-panel.css` exports；保留 `./keyboard`。
- 从 `./hooks` 删除 pointer-reorder 导出，保留 clipboard/reduced-motion/media-query/mobile。
- 原 `components.css` 仅保留 control-icons 导入；ui 自身 styles.css 继续只是基础样式，产品完整区域样式由 Shell 统一聚合。
- `selectorValidationErrorStyles` 与 menu styles 同时服务基础 Select/Dropdown，保持 ui 的现有公开出口，新包使用公开接口。

## 词典/CSS/测试特殊映射

- `ui/src/i18n/en-US.ts`、zh-CN.ts 的 colorPicker 子树 → ui-settings 对应 locale 的 `ui.colorPicker`。其余 ui 文案保留；key、插值和值不变。
- Shell 原 `@workbench/ui/components.css` 位置展开为 `@workbench/ui-sidebar/styles.css` → `@workbench/ui/components.css` → `@workbench/ui-settings/color-picker.css`。
- ui-layout 第一条比例 CSS import 改为 `@workbench/ui-resize/styles.css`。
- `ui/tests/ui/shared-foundations.test.tsx` 同时覆盖基础 Settings/Tabs 和 SearchableSelector：保留该跨包 UI 文件、不增加 UI 测试；selector symbols 改公开新包 import，ui manifest 仅以 devDependency 声明该测试消费。不得让 src 引用这个 devDependency。
- Shell 中纯 proportional-panel-size 断言仅更新 import，仍属宿主消费契约；不盲目迁移所有名称带 resize 的测试。

## 全局消费者更新范围

root/package manifests、pnpm-lock、Shell/ui-layout CSS、ui/src/index.ts、components/index.ts、hooks/index.ts、ui/settings/sidebar 词典/样式入口由主 Agent 写入。各能力 Agent 提交自身消费者建议，合并顺序由主 Agent 控制。

`apps/web`、`apps/desktop-renderer` 已使用 client 通配 Tailwind source；核对新 src/lib 被扫描，不为已有 glob 重复增加路径。更新源码边界脚本中的 owner 根列表、ui shared-foundations/Host static tests、根 AGENTS 的选择器 owner 和相关技能指导。不得用旧 ui facade 掩盖未迁移消费者。
