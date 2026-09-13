# Spec 004 — 按产品职责细分 UI 能力

基线：8ee7ee24。状态：Implemented。分支：codex/package-refactor。

用户指出 Spec 003 拆分仍不够细，并提供以 ui-attachment、ui-input-trigger、ui-model-selection、ui-theme、ui-tool、ui-user-questions、分项设置等为独立包的目录参考。本轮扩大检查范围到现有业务 UI 大包，完成本期 15 个产品能力包的拆分；不重写已完成 Spec 001–003。

## User Stories

1. P1：开发者可以按附件、输入触发、模型选择、外观、工具展示与交互请求等产品职责找到独立 owner，而非继续集中在 conversation/composer/ui-settings。
2. P1：功能包可通过公共契约组合，原有状态、词典、样式、扩展注册和销毁边界随 owner 完整迁移，基础层不回引装配层。
3. P1：实施可按完整能力分波交付，每项有真实源码/helper/消费者与验证范围，不复制参考中本项目没有的功能。

## Requirements

- UI 包按 ui-* 命名，目录叶名与包名后缀一致；保持 packages/<领域>/<能力> 两级分类。
- 参考包的业务职责粒度；本仓 lib 继续为手写 TS/TSX helper，不复制参考的生成 JS/map/tsbuildinfo、构建系统或 invariant 空壳。
- 现有功能完整移动，包括源码、真实辅助、资源、词典、既有测试与注册；共享 primitives、运行时与领域模型复用已有 owner。
- 每个新包含真实 src/lib、公共 exports、workspace 依赖和双语 README；旧大包只保留明确的装配或单项职责。
- 同时处理现有 i18n 聚合反向依赖，词典键及稳定 ID/协议/持久化格式保持；Portal 与主题配置保持。
- 不新增或运行 UI/DOM/fake DOM/视觉/交互/Browser/Electron 冒烟测试；既有测试保留并记录 excluded-by-user。允许静态/明确非 UI 逻辑检查、lint/typecheck/build。
- 子 Agent 按能力派发 GPT-5.6 Luna 与 Sol；共享 manifests/lock/入口/词典安装/CSS/Spec 由主 Agent 集成。

## Success Criteria

参考顶层能力逐项映射为当前 owner、确定拆分或不适用，不能凭目录名虚构实现。每项拆分列出真实来源、内部辅助、消费者和依赖切断策略。实施证据见 validation.md；逐文件迁移与测试保留见 migration-inventory.json。全部 25 项任务已完成，UI 验证按用户约束排除。
