# Tasks — Spec 005

输入：spec/plan/research/data-model/package-map/contracts/quickstart。全部沿当前未提交 Spec004 工作树继续；不提交或推送。

## Phase 1: Setup

- [x] T001 读取技能与 specs/005-conversation-capability-split 设计，运行 setup-tasks 并核对 hooks/checklists/ignore。
- [x] T002 保存 source-inventory.json 对应工作树来源与全部既有测试清单；逐能力移动前登记映射。

## Phase 2: Foundation

- [x] T003 将 packages/conversation/composer 整包改名 ui-composer，统一全仓包前缀/路径并保留现有出口。
- [x] T004 在 packages/client/ui-sidebar 保留泛型 sidebar-reorder 的 src 公共入口并把算法提取至 lib，供基础拖放与新列表消费。

## Phase 3: US1 — 独立能力（P1）

验收：每个 owner 有真实 src/lib、合法 exports、双语词典/README及完整测试来源，完成标记等待集成验证。

- [x] T005 [P] [US1] 从 packages/conversation/conversation 提取 ui-message-blocks，拆开 composer-message-text Context wrapper/Content，提取实际 file-data helper。
- [x] T006 [US1] 从 packages/conversation/conversation 提取 ui-conversation-nodes，完整迁移 message/structure/steered Context、NodeSeat与消息级 renderer 扩展。
- [x] T007 [US1] 从 packages/conversation/conversation 提取 ui-conversation-messages，迁移 list/layout/viewport/scroll/rows及相关辅助。
- [x] T008 [P] [US1] 从 packages/client/ui-sidebar 提取 packages/conversation/ui-conversation-list，完整迁移业务 controller/section/order/move/menu/扩展与测试。
- [x] T009 [US1] 将剩余 packages/conversation/conversation 收口改名 ui-conversation，只保留顶层会话装配及真实 helper。

## Phase 4: US2 — 契约与集成（P1）

验收：生产依赖无环，唯一Context/运行时/词典，旧入口无兼容回引。

- [x] T010 [US2] 更新 packages/client/shell 与全部 packages/apps/scripts 的消费者，按 blocks/nodes/messages/list 分类迁移公开入口。
- [x] T011 [US2] 同步 packages/client/shell/src/i18n/runtime.ts 及 Pi bundles、移动旧键并校验两种locale键/值/formatter唯一等价。
- [x] T012 [US2] 同步 packages/client/shell/src/styles.css 和各包CSS入口，保持区域选择器、主题token和层叠。
- [x] T013 [US2] 更新各package.json/tsconfig.json、pnpm-lock.yaml、scripts边界守卫与活跃文档，删除旧目录/转导出。

## Phase 5: US3 — 验证（P1）

验收：测试文件不减少；UI排除，其余允许检查通过。

- [x] T014 [US3] 在 specs/005-conversation-capability-split/migration-inventory.json 记录完整映射/部分提取/测试/公共API/CSS与Context审计。
- [x] T015 [US3] 核对既有测试的导入与fixture，精确运行审计后的非UI逻辑及静态边界检查；UI/DOM/fake DOM一律excluded-by-user。
- [x] T016 [US3] 运行 pnpm lint、check:workspace-dependencies、check:package-structure、typecheck、build 与 frozen-lockfile 检查并修复。

## Phase 6: Polish

- [x] T017 更新 specs/005-conversation-capability-split/{spec,plan,validation}.md 和 AGENTS.md 状态，清空迁移残余目录，git diff --check。

依赖：T001/T002→T003/T004→T005→T006→T007→T009→T010–T013→T014–T016→T017。
T008 可与 T005–T007 并行。Luna独占blocks来源及目标；Sol独占nodes/messages来源及目标；主Agent独占sidebar业务迁移、composer改名与共享文件。原conversation主词典由主Agent最终切分，子Agent报告所需键，不同时改原词典。完整交付全部任务，不以单包改名作为完成。

## Client 目录归属调整（用户后续要求）

- [x] T018 将 packages/conversation 下 16 个 UI 能力包整体迁到 packages/client，更新 workspace/扫描/路径/锁文件并删除空父目录。
- [x] T019 验证 client-placement.json 文件保留清单、静态边界、结构/依赖、lint/typecheck/build，记录本次调整结果。
