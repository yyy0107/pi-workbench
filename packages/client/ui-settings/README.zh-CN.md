# @workbench/ui-settings

负责共享设置容器：settings registry 集成、主视图、导航侧栏、侧栏 rail、设置命令和设置触发器。功能包通过公开 settings registry 贡献分区和设置项；`ui-settings-general` 贡献语言与会话偏好，`ui-theme` 贡献外观设置。

本包保留 Shell 与 workspace 消费的 settings request 和 surface 契约。`src/` 放容器实现、契约、样式及本包设置词典；`lib/` 只放实际使用的容器辅助模块。测试位于 `tests/`，源码统一保留 TypeScript/TSX。

`extensions.settings.general` 和 `extensions.settings.groups.*` 文案归容器所有；功能文案由各自 owner 注册。消费者使用公开的 `./request`、`./surface`、`./sidebar`、`./sidebar-rail`、`./i18n` 和 `./styles.css` 入口。
