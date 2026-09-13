# Client 组件包迁移映射

## 第二阶段目标映射（待实施，覆盖六包原目录保持假设）

本节是目标设计。Spec 001 的清单与 JSON inventories 保留前置重构事实；本 Spec 的机器清单在实施时独立建立。

| 当前路径                             | 目标路径                          | 包名策略                          |
| ------------------------------------ | --------------------------------- | --------------------------------- |
| packages/workbench/shell             | packages/client/shell             | 保留 @workbench/shell             |
| packages/workbench/pi-product        | packages/client/pi-product        | 保留 @workbench/pi-product        |
| packages/workbench/host-client       | packages/client/host-client       | 保留 @workbench/host-client       |
| packages/workbench/services-client   | packages/client/services-client   | 保留 @workbench/services-client   |
| packages/workbench/host-contracts    | packages/client/host-contracts    | 保留 @workbench/host-contracts    |
| packages/workbench/desktop-contracts | packages/client/desktop-contracts | 保留 @workbench/desktop-contracts |

以下来源均相对移动后的 client/shell；对应消费者须同批修改。

| 来源                                                                                                                 | 目标/公开入口                                                       | 直接消费者与连带内容                                                                           |
| -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| src/sidebar 的 thread-_/workspace-_/new-thread-button/running-thread-indicator/sidebar-move/sidebar-reorder          | client/ui-sidebar，@workbench/ui-sidebar                            | layout、workspace-sidebar 扩展；lib/thread-sort.ts、对应 tests/sidebar、双语 sidebar keys 同迁 |
| src/extensions/workspace-sidebar.ts                                                                                  | ui-sidebar/src/extension.ts，@workbench/ui-sidebar/extension        | Shell extension catalog；保持 workbench.workspace-sidebar ID 与 workspace section              |
| src/shell/conversation-actions-menu.tsx                                                                              | ui-sidebar/src/conversation-actions-menu.tsx，@workbench/ui-sidebar | layout Header；thread.menu Slot 与菜单双语 keys 同迁                                           |
| src/panels/*                                                                                                         | client/ui-panels，@workbench/ui-panels                              | layout；panel tests、尺寸辅助、panels keys 同迁；store 留 shell-context                        |
| src/shell（除命令面板、线程菜单）及 src/hosts/statusbar.tsx                                                          | client/ui-layout，@workbench/ui-layout                              | Shell application、应用直接布局消费者；layout/resize/hydration 测试与区域 CSS 同迁             |
| src/sidebar/sidebar-primary-navigation.*、sidebar-resize-handle.tsx                                                  | ui-layout/src/                                                      | frame 外框导航/尺寸生命周期及 CSS module，非线程列表                                           |
| src/extensions/workbench-brand*                                                                                      | ui-layout/src/                                                      | Shell 安装目录；品牌扩展文本及测试                                                             |
| src/shell/command-palette-host.tsx                                                                                   | extension-platform/host，@workbench/extension-host/command-palette  | ui-layout 全局层；保留此已有入口的原 exports，增加组件导出；平台词典及键盘辅助留 Host          |
| src/application.tsx、browser-session-persistence.ts、i18n/provider.tsx、extensions/builtin-extensions.ts、styles.css | client/shell 保留                                                   | Pi product/Web/Desktop；只负责安装、持久化适配、词典/扩展/CSS 聚合                             |

@workbench/shell/application 与 /styles.css 保持。迁出组件的 /workbench、/panels、/hosts/statusbar 由所有消费者改用新 owner 后删除；不长期保留纯转发。/extensions 保留默认安装分组；/i18n 保留应用适配所需 API，消费者改用能力 bundle 后收窄。未列出的文件先按实际消费者归属记录到迁移清单，不能遗落在旧 workbench 目录。

参考对应：ui-sidebar → 新 sidebar；ui-layout → 新 layout 与 panels；ui-primitives/ui-theme/ui-settings → 既有 ui/appearance/settings-ui；ui-conversation/ui-attachment/ui-input-trigger → 既有 conversation/composer 的能力，不另建重复包；connection/runtime → 既有 host-client/services-client/agent-runtime/Pi transport，不合并传输实例。
