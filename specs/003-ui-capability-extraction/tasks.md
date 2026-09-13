# Tasks: UI 能力继续提取（Spec 003）

Input: 本目录 spec.md、plan.md、research.md、data-model.md、contracts/ui-capabilities.md。

用户已授权实施。所有路径相对仓库根；不新增或执行 UI 测试，既有 UI 用例迁移并记录 excluded-by-user。主 Agent 集成共享入口、manifest、lock、CSS 与 Spec；Luna/Sol 按完整能力派发。

## Phase 1: Setup

- [x] T001 核实工作树、工具与迁移基线，读取 specs/003-ui-capability-extraction/plan.md 和技能执行规则。

## Phase 2: Foundation

- [x] T002 核对 specs/003-ui-capability-extraction/migration-inventory.json、最近 AGENTS.md、.gitignore 和 package.json 验证脚本，冻结合同及测试排除范围。

## Phase 3: US1 — 具体能力所有权（P1）

目标：三个真实新包与三个已有 owner 接收完整实现。独立验收：来源/目标无遗漏、公开接口和 helper 消费保持；完成标记须等共享集成通过。

- [x] T003 [P] [US1] Luna 将三组选择器迁入 packages/client/ui-selectors/src，提取 lib/selector-dropdown-metrics.ts，迁移既有测试并补双语 README。
- [x] T004 [P] [US1] Sol 将 resize hooks/handle/helpers/CSS/既有测试整体迁入 packages/client/ui-resize，保持观察与清理合同。
- [x] T005 [US1] Sol 将 disclosure Context/details/lock/helpers/既有测试整体迁入 packages/client/ui-disclosure，保持唯一锁状态与事件。
- [x] T006 [US1] Luna 在 T003 后将模型视图/helper/既有测试迁入 packages/client/ui-agent-controls/src/model-selector-view.tsx 和 lib/model-selector-models.ts，提供 selector/models 入口。
- [x] T007 [P] [US1] 将 ColorPicker/CSS/normalize helper/既有逻辑测试迁入 packages/client/ui-settings，原样迁移 ui.colorPicker 双语子树并接入共享 bundle。
- [x] T008 [US1] Sol 将 Sidebar/行组件/reorder/CSS/既有测试迁入 packages/client/ui-sidebar，提供 primitives/reorder 窄入口并修改本包消费者。

## Phase 4: US2 — 公开依赖与集成（P1）

目标：基础 ui 无反向依赖，消费者只引用公开 API。独立验收：生产依赖无环、无旧入口和跨包内部路径、实际包结构通过。

- [x] T009 [US2] 同步 packages/client/ui/src/index.ts、components/index.ts、hooks/index.ts，删除迁出能力旧出口并更新所有 packages/apps 消费者及保留测试的导入。
- [x] T010 [US2] 在 packages/client/shell/src/styles.css、ui-layout/src/styles.css 和 ui/src/components.css 保持原 CSS 顺序并接入新 owner。
- [x] T011 [US2] 更新相关 packages/_/_/package.json、tsconfig.json 和 pnpm-lock.yaml，按真实 import 声明依赖、exports、CSS sideEffects。
- [x] T012 [US2] 同步 scripts/extension-boundaries.test.ts、静态守卫及当前 AGENTS.md/技能/README 的归属路径，保留历史 Spec 001/002。
- [x] T013 [US2] 运行 package.json 中结构和依赖检查，修复实际遗漏或依赖环，不放宽守卫。

## Phase 5: US3 — 有界验收（P1）

目标：按用户允许范围完成证据。独立验收：明确非 UI 逻辑测试、lint、typecheck、build 成功；不宣称 UI 实测。

- [x] T014 [US3] 静态核对 specs/003-ui-capability-extraction/contracts/ui-capabilities.md 中 props/Context/Portal/事件清理、词典键插值、CSS 顺序及全部测试映射。
- [x] T015 [US3] 精确运行 ui-resize/tests/resize-spring.test.ts、ui-disclosure/tests/disclosure-scroll-policy.test.ts、ui-agent-controls/tests/model-selector-models.test.ts、ui-settings/tests/color-picker.test.ts 和 shell/tests/resize/proportional-panel-size.test.ts。
- [x] T016 [US3] 执行 package.json 的 lint、typecheck、build，修复本次迁移导致的失败；日志记录在 /tmp/spec003-*。

## Phase 6: 收口

- [x] T017 更新 specs/003-ui-capability-extraction/migration-inventory.json、spec.md、plan.md 和 quickstart.md 的实际状态与验证证据，删除迁移后空目录，执行 git diff --check。

## Dependencies and parallel execution

T001 → T002 → [T003 → T006 | T004 → T005 → T008 | T007] → T009/T010/T011 → T012/T013 → T014/T015/T016 → T017。

US1 的源码交付允许 US2 依次接通，完整能力在集成检查后验收，不能留下 ui 回引新包的中间终态。最小可交付范围为 selectors + model view 的完整迁移；本次继续完成全部范围。

US1：Luna 的 selectors/model 与 Sol 的 resize/disclosure 分文件并行，主 Agent 完成 color；Sol 随后 sidebar。US2：共享文件由主 Agent 串行写入，避免 manifest/入口冲突。US3：独立只读检查可并行；构建与写入依赖的步骤串行。所有 UI 测试保留且 excluded-by-user，不运行混合 test/check 或 Browser。提交与推送等待用户明确请求。
