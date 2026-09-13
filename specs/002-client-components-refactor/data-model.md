# Client 重构管理对象

## 第二阶段的管理对象与不变量

| 对象                    | 字段                                                               | 校验/关系                                                                   |
| ----------------------- | ------------------------------------------------------------------ | --------------------------------------------------------------------------- |
| ClientPackageRelocation | packageName, fromRoot, toRoot, exportsBefore                       | 六包 name 唯一且不变；目标必须位于 client；公开入口变动需明确映射到新 owner |
| ComponentOwnership      | sourceFiles, ownerPackage, publicEntry, consumers, helperConsumers | 每个实现唯一 owner；辅助有真实消费者；消费者只访问公开入口，依赖无环        |
| TranslationOwnership    | semanticKey, ownerBundle, locales, parameters                      | en-US/zh-CN 键与参数一致；同一个稳定键不由多个能力重复定义；Shell 聚合一次  |
| StyleOwnership          | sourceStyle, targetEntry, scopeMarkers, importOrder                | Shell 统一入口，布局/侧栏/面板规则作用域不扩大，Portal 标记与顺序保持       |
| ValidationEvidence      | stage, command, status, affectedPackages, testInventory            | 本阶段证据不能引用上一阶段通过结论充数，测试逐文件对应                      |

迁移状态：planned → moved → consumers-updated → verified。任一验证失败保持未完成；回退仅回退同一批受控修改，不撤销用户其他变更。本 Spec 的任务编号从 T001 开始，由 speckit-tasks 生成独立 tasks.md。没有新增运行时状态机、协议字段或持久化实体。

## 能力派发与验证范围字段

能力任务补充 capability、assignedModel（gpt-5.6-luna 或 gpt-5.6-sol）、writeScope、dependencies、publicContracts、validationScope。同一写入范围只能有一个活跃 owner；共享文件由主 Agent 协调。验证证据标注 non-ui-test/static/build 或 excluded-by-user；UI 测试只能记为 excluded-by-user，不能标 passed，也不阻塞 verified。
