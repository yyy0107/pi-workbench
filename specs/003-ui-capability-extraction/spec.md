# Feature Specification: UI 基础包继续提取能力

**Feature ID**: `003-ui-capability-extraction`
**Working Branch**: `codex/package-refactor`
**Status**: Implemented — 17 项任务及允许范围内验收完成，见 validation.md
**Baseline**: `8d4b6568`；Spec 001/002 保持原记录。

## 请求

继续从 `packages/client/ui` 提取职责完整的 `ui-*` 能力包。沿用已完成的全仓命名统一与 i18n 去重，按用户后续指令实施源码迁移。

## Requirements

- FR-001：以实际组件/辅助/样式/词典/测试及消费者依赖为依据拆分，不能只按文件名创建一组件一空包。
- FR-002：保留 UI primitives、语义 tokens、Portal 与通用辅助的基础所有权，基础包不回引提取能力；公开依赖无环。
- FR-003：优先复用已有 `ui-*` owner；确需新包必须有实际 src/lib 职责、显式 exports、workspace:*、双语 README 与现有测试去向。
- FR-004：所有 UI 能力使用 `ui-*` 名称，目录叶名与 package name 后缀一致；保留 TS/TSX、两级包根和浅层 src/lib。
- FR-005：词典用 `src/i18n/{index,en-US,zh-CN}.ts`；`useI18n(bundle)` 复用唯一上下文；无自建 Hook、重复键注册或全局字典。
- FR-006：完整保留 props、受控状态、ID、键盘、Portal、Observer/timer/RAF 清理、回调时机和样式/token 行为；不改变业务和持久化格式。
- FR-007：每批迁移同步消费者、包 exports、CSS 聚合、锁文件、静态守卫和当前文档；最终删除旧转发，无新基线。
- FR-008：不新增或运行 UI 测试、DOM/视觉/交互、Browser/Electron 自动化或手工冒烟；保留既有文件并记录 excluded-by-user。允许精确筛选非 UI 检查、lint、typecheck、结构/依赖及构建。
- FR-009：实施时按完整能力派发 GPT-5.6 Luna/Sol；主 Agent 统一修改共享 manifests/锁文件/聚合入口/Spec。原计划阶段只读研究；用户已授权执行本计划。

## User Stories and Acceptance

1. 开发者可从具体 `ui-*` owner 查找富选择和交互能力；基础 `ui` 导出收窄，没有组件副本。
2. 消费者只通过公开入口引用新 owner；生产依赖检查通过，真实 helper 有消费者。
3. 用户现有行为由静态合同、相关非 UI 逻辑检查和构建核对，UI 测试按约束排除。

## Success Criteria

- SC-001：确定的每项能力都有逐文件映射、消费者与验证范围；没有待定归属。
- SC-002：实施后源与测试映射完整，旧入口无活跃消费者，依赖/类型/结构检查通过。
- SC-003：双语键/插值、CSS 聚合/Portal、事件清理及原 props 保持。
- SC-004：当轮允许的检查与构建通过后再记录完成；本规划不能充当实施验收。
