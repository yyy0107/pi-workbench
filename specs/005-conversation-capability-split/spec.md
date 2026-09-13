# Spec 005 — 会话装配、列表、节点与消息块拆分

状态：Implemented。分支：codex/package-refactor。输入基线为 Spec 004 已实施但尚未提交的工作树；HEAD 8ee7ee24 不能单独代表本轮源码基线。

用户要求 composer 改名 ui-composer、conversation 改名 ui-conversation，并继续拆出对话列表、会话节点、消息块。ui-comversation 按拼写笔误统一为 ui-conversation。

## 用户场景与验收

1. 开发者按包名定位会话外壳、编辑器、会话导航列表、消息流、节点呈现和块渲染，无需在一个大包中查找。
2. 每个 owner 独立公开真实能力，公共类型/Context/状态不重复；现有扩展消费公共入口，生产图无环。
3. 源码、内部辅助、双语文案、样式、测试与消费者一起迁移；结构/类型/构建和精确非 UI 验证通过后才标记完成。

## 约束

- 参考职责，不照搬 src/client/chat 多层目录、构建工具或本项目不存在的节点定义。
- src/lib 保留手写 TS/TSX、实际消费者及最多一级子目录；包根 tests 和双语 README。
- 已有 agent-runtime-contracts 和 agent-runtime-client 继续拥有节点协议与订阅/状态；本轮不建立第二套会话节点存储。
- UI 测试、DOM/fake DOM、视觉/交互及 Browser/Electron 冒烟不新增不执行；既有测试必须保留。
- 继续按能力派发 Luna/Sol，主 Agent 集成；不自动提交或推送。
- Spec 004 实施与验收记录保持，本轮实际验收见 validation.md，逐文件迁移见 migration-inventory.json。
