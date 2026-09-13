# @workbench/ui-input-trigger

Owns the ui-input-trigger capability, its real source, consumed helpers and local dictionaries. Public exports preserve existing APIs; shared runtime and Portal state are reused.

本包拥有ui-input-trigger完整能力，src为真实实现、lib为被消费的辅助，保持浅层TS/TSX。词典和既有测试随能力迁移；UI测试excluded-by-user，不新增全局状态。

公开 ./tokens 入口负责 Composer 和已发送消息共用的命令 token 与图标呈现，不持有编辑器或 Session。
