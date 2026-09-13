# UI 能力迁移合同

这是内部 workspace 公开接口合同，不新增网络 API、数据库模型、用户功能或扩展。

## C1 — 公开接口与依赖

ui-selectors 的 `.` 保留 SearchableSelector 全组件族/泛型、SelectorDropdown hooks/常量、WorkspaceSelector props/types。ui-resize 的 `.` 保留旧 `/resize` 全部算法/hooks/types，并加入 CollapsibleResizeHandle；`./styles.css` 保留比例面板 CSS。ui-disclosure 的 `.` 保留旧 `/disclosure` 的所有方法、事件常量和类型。

ModelSelector 的视觉入口是 `@workbench/ui-agent-controls/selector`，模型类型/filter 是 `/models`；不得覆盖现有业务 model-selector.tsx。ColorPicker 从 ui-settings/color-picker 提供。Sidebar 基础 Provider/行组件从 ui-sidebar/primitives 提供，pointer/reorder 从 /reorder 提供。同包使用本地 imports，跨包只能使用公开 exports。

基础 ui 不生产依赖任何此次提取的 owner；新 owner 可以依赖 ui 的现有基础能力。ui/测试为保留 shared-foundations 的 selector 集成可 devDepend ui-selectors，但 src/lib 不能消费。禁止为了兼容恢复 ui→能力包→ui 转发环。

## C2 — 状态和生命周期

- Selector：保留单选/多选泛型、controlled/default 值、过滤顺序、labels、disabled/invalid/required、trigger refs、open/close/width 动画及回调时机；CSS transition 计算移动不改变 DOM layout read 次数。Base UI/cmdk 所有权不改。
- ColorPicker：保留 color/onChange/onChangeEnd、hex 正规化、外部 color 同步、saturation/hue 的本地化 ARIA 更新与 MutationObserver 清理。只迁 owner，不修改颜色格式。
- Resize：保留阈值、snap/velocity、spring/reduced-motion、pointer capture、键盘步长、Observer/RAF/cancel 清理、aria 数值与跨布局回调。handle 必须随 hooks 移动，只有一份状态实现。
- Disclosure：保留锁定/unlock event 字符串、锁查询、方向 Context、展开滚动补偿；viewport 和 details 必须使用同一模块实例，不能复制锁或恢复第二套全局状态。
- Sidebar：原 Context、Provider 层级、展开/移动端状态、快捷键 owner 判断、拖放抑制点击/重排状态和清理保持；ui-layout 继续只安装一次 Provider。Keyboard owner 和 Portal Context 仍取基础 ui，不把 Extension Host 引入环。

## C3 — i18n

保留 `ui.colorPicker.hex/red/green/blue/hue/saturation/saturationValue` 七个完整语义键，en-US/zh-CN 值和 `{saturation, brightness}` 插值保持；唯一归属从 ui bundle 移到已安装 settings bundle。两 bundle ID 保持稳定。先同步唯一键 owner 与消费者，再验证 duplicate/missing-key 检查。Toaster/capabilityUnavailable 等其余 ui 键不移动。

新 selectors/resize/disclosure 不自建词典、空 bundle 或 Hook；所有现有 labels/ariaLabel 继续来自调用方。需要 bundle 的 ColorPicker 使用共享 `useI18n(settingsUiTranslationBundle)`，入口仅从 i18n/runtime 创建 bundle。

## C4 — 样式、资源和 Portal

CSS 内容与作用域原样迁移。原 ui/components.css 的顺序是 sidebar-items → control-icons → color-picker；Shell 中对应位置替换为 sidebar/styles → ui/components（只余 icons）→ ui-settings/color-picker.css。其他 CSS 的相对位置不变，ui/tokens 仍最后。不能简单把颜色 CSS 提前塞入 appearance-background.css，避免改变层叠顺序。

ui-layout 原比例样式位置使用 ui-resize/styles.css。声明 CSS public exports 与 sideEffects，Shell 仍是 Web/Desktop 唯一产品聚合入口；不向基础 ui/styles.css 反引新能力。

Portal container、sidebar surface 标记以及位于 Portal 的 sidebar-menu sibling CSS 规则保持。各区域继续从主题/颜色/密度/圆角 token 派生；迁移不新增固定值、主题分支或新的 DOM 范围。

## C5 — 测试与验证边界

原20个 ui 测试文件都有明确去向，不删除。组件/渲染/DOM/fake DOM/交互测试只移动和改路径，状态 excluded-by-user。含 UI 的 .test.ts 文件也排除，禁止靠改后缀、拆函数或 test-name-pattern 绕过用户约束去执行 UI 场景。

纯 spring 数值、比例、disclosure policy、模型 filter 和 normalizeHexColor 可精确执行；颜色用例改为本包纯 helper import。跨包导出/类名/词典/生命周期通过源码、类型、边界和构建验证。计划本身不声称 UI 实测或实现验收通过。
