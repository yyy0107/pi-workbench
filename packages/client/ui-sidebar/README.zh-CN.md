# @workbench/ui-sidebar

负责会话和工作区侧栏能力，包括线程/工作区排序列表、拖放策略、会话操作菜单以及工作区侧栏扩展。`src` 存放能力实现和契约，`lib` 存放实际使用的线程排序辅助模块，测试位于包根目录。

本包通过 `sidebarTranslationBundle` 使用共享的 `@workbench/i18n` 运行时。Shell 与其他能力 bundle 一起安装该 bundle；本包不导入 Shell 的 i18n 或聚合词典。
