# Client 组件包接口合同（第二阶段）

本合同定义迁移后可检查的接口与兼容行为，不引入 RPC 或新数据格式。前置 [包边界合同](../../001-workbench-package-refactor/contracts/package-boundaries.md) 的通用约束继续适用。

## 包入口

| Owner                                     | 显式入口与责任                                                                                                | 禁止依赖                               |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| @workbench/ui-sidebar                     | 根导出线程/工作区列表与 ConversationActionsMenu；/extension 导出 workspaceSidebarExtension；/i18n 导出 bundle | shell、ui-layout、pi-product、Pi 实现  |
| @workbench/ui-panels                      | 根导出 PanelLayout/PanelDock/TerminalDrawer 与必要组件类型；/i18n 导出 bundle；有独立 CSS 时明确 styles.css   | shell、ui-layout、terminal-ui、Pi 实现 |
| @workbench/ui-layout                      | 根导出 WorkbenchShell 与现有 props 类型；/statusbar、/extension、/i18n、/styles.css 为显式必要入口            | shell、pi-product、Pi 实现             |
| @workbench/extension-host/command-palette | 保留已有目录/命令 exports，新增 CommandPaletteHost 与 props                                                   | Shell 和新功能组件包                   |
| @workbench/shell                          | /application 保留安装 API，/styles.css 保留聚合，/extensions 保留默认扩展组；i18n 保留应用适配                | 不持有已迁出的组件副本                 |

以上是允许的公开边界，具体导出符号从旧入口逐项映射，不能加通配 src/lib exports。六个物理迁移包均保留原 name，workspace:* 依赖继续解析。所有仓内 /workbench、/panels、/hosts/statusbar 消费者必须切换后才删除 Shell 旧组件入口。

## Props 与生命周期兼容

- WorkbenchShell 保留 assets、branding、children、installationEffects、mainViewHost、runningIndicatorCatalog、threadScrollPersistence 原类型和语义。类型引用真正能力所有者，不回指 Shell。
- CommandPaletteHost 保留 ownerRootRef、受控/非受控 open、shortcut、placeholder、emptyMessage 等 props 和失败反馈；使用同一 CommandService，不新增监听实例。只由原全局层挂载一次。
- WorkspaceSidebar Context、线程顺序存储和设置资源沿用原 scope/key；不复制 agent runtime thread/message 状态。
- Panel store 仍在 shell-context，应用仍拥有安装实例；隐藏 RightWorkspace 不销毁底部终端。
- Extension ID、section ID、thread.menu Slot、默认分组顺序、快捷键与 onDispose 释放行为不变。布局组件导入不产生安装副作用。

## i18n 与样式

每个能力用统一 defineTranslationBundle/useTranslationBundle 机制，词典随组件。Shell Provider 只做设置 hydration 与 bundles 聚合，保留 revision 和 cookie 行为。能力不能 import shell/i18n 或聚合 messages；平台命令面板使用平台词典。缺键开发/测试失败或显式告警，生产最终回退 en-US。

@workbench/shell/styles.css 是 Web/Desktop 唯一统一样式入口。ui-layout 的样式独立导出，由 Shell 在旧聚合位置导入；布局 CSS 不回引聚合入口。保持 data-workbench-shell、sidebar、panel 和 Portal 区域标记；token 派生在消费作用域计算。复用共享 UI 控件，不因迁移重绘控件或复制交互状态样式。

## 可验证失败条件

任一新包回引 Shell、重复稳定翻译键/扩展 ID、测试迁移丢失、旧物理路径运行时不可解析、重复实例/监听、Portal 跨安装串用、丢失 CSS 副作用声明均阻止完成。结构检查继续严格，不为本次搬迁重新扩大基线。

## 本轮验证约束

上述行为合同保持有效；UI 相关部分仅静态审查，不新增或执行渲染、交互、DOM 快照、视觉、Browser/Electron UI 测试或手工 UI 冒烟。保留迁移既有 UI 测试文件，但执行结果记为按用户约束排除。非 UI 逻辑、类型、结构/依赖及构建继续验证。

实施冻结：`workbench.shell.workspace` 为 sidebar 扩展标题键，由 sidebar bundle 唯一拥有，Header 通过 sidebar bundle 使用；其余 `workbench.shell.*` 归 layout。此细分避免 sidebar → layout 循环。
