# Data Model: 迁移记录与所有权

本轮不新增产品数据实体或持久化结构，下列实体用于实施清单与验收。

## CapabilityOwnership

字段：packageName、root、publicExports、sourceFiles、helperFiles、helperConsumers、dependencies、localeOwner、styleOwner、tests、directConsumers。

规则：目录叶名等于 @workbench 后缀；每个新包有真实 src/lib 和 helper 消费者；同一实现只能一个 owner；共享基础 ui 不回引提取能力。三个新 owner 为 ui-selectors/ui-resize/ui-disclosure，三个 existing owner 为 ui-agent-controls/ui-settings/ui-sidebar。

## MigrationEntry

字段：source、target、owner、action（retain/move/extract-subset）、validation。inventory 的整文件映射覆盖 ui 全部100个受控文件；partialExtractions 记录 normalizeHexColor、selector metrics 和文案子树等不可用单文件移动描述的变化。

规则：每个来源有去向，目标与现存源码冲突时采用合同指定文件名；除实际共享集合的键移动外不复制实现。测试文件保留原断言与验证类别。

## PublicConsumer

字段：sourcePackage、sourceFile、oldImport、newImport、symbols、productionOrTest、integrationOwner。

规则：现有混合 UI 测试可以保留在基础包并 test-only 引用新包；生产依赖仍须无环。每个旧 root/subpath 导出只有在所有消费者完成后删除。

## TranslationOwnership / StyleOwnership

字段：bundleId、semanticKeys、localeFiles、cssEntry、aggregatePosition、portalScope。

规则：只迁 ui.colorPicker 子树，双语/插值保持且无重复安装。CSS sidebar/icons/color 顺序不变；区域 DOM/Portal 标记和 tokens 不变。

## ValidationEvidence

字段：capability、state、checks、results、excludedUiFiles、consumerCoverage、baselineCommit。

实施状态：planned → extracted → integrated → verified。缺少消费者集成只能停在 extracted；验证失败不能标 verified。UI excluded-by-user 是约束状态，不等于通过或阻塞。当前所有条目均 planned。
