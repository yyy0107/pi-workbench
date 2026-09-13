# @workbench/ui-input-trigger

Owns the ui-input-trigger capability, its real source, consumed helpers and local dictionaries. Public exports preserve existing APIs; shared runtime and Portal state are reused.

本包拥有ui-input-trigger完整能力，src为真实实现、lib为被消费的辅助，保持浅层TS/TSX。词典和既有测试随能力迁移；UI测试excluded-by-user，不新增全局状态。

The public ./tokens entry owns shared command token and icon presentation for both Composer and sent messages; it does not own the editor or Session.
