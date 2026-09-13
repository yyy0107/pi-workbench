# @workbench/ui-tool

Owns the ui-tool capability, its real source, consumed helpers and local dictionaries. Public exports preserve existing APIs; shared runtime and Portal state are reused.

本包拥有ui-tool完整能力，src为真实实现、lib为被消费的辅助，保持浅层TS/TSX。词典和既有测试随能力迁移；UI测试excluded-by-user，不新增全局状态。

Generic tool timelines consume resolved presentation metadata and exact renderers. Protocol parsing, file mutations and workspace opening belong to Pi contributions.
