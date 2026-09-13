# @workbench/pi-ui-settings

负责 Pi Agent 配置设置、系统提示词与追加提示词编辑器、动态提示词占位符、缓存未命中提示和配置文件操作。Pi provider/model 配置现归 `@workbench/pi-ui-settings-models`。

`src/` 放 Agent 配置扩展、设置项、缓存提示、配置操作、本地词典和提示词占位符样式；`lib/` 放实际使用的提示词占位符高亮辅助模块。测试位于 `tests/`；Pi client/protocol 行为继续通过公开 Pi client 边界访问。

本包保持既有 Agent 配置扩展 ID、设置项 ID、提示词持久化和资源释放行为。消费者使用公开包入口和 `./i18n` bundle；模型配置消费者使用 `@workbench/pi-ui-settings-models`。
