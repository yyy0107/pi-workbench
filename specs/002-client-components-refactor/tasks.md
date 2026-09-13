# Tasks: Client 归属与 Shell 组件拆分

**Input**：本目录 spec.md、plan.md、research.md、package-map.md、data-model.md、contracts/client-components.md、quickstart.md。

**Feature**：002-client-components-refactor；真实 Git 分支 codex/package-refactor。Spec 001 保持原样。本清单独立从 T001 编号，实施状态见任务勾选和 validation.md。

## 执行规则

- 用户最新约束优先：不新增、不运行 UI 测试、Browser/Electron UI 自动化或手工交互冒烟。保留并迁移既有 UI 测试文件，可修正路径；执行状态记录 excluded-by-user，不冒充通过，也不阻塞完成。
- 允许静态源码/词典/样式审查、lint、typecheck、包结构/依赖检查、构建及精确筛选的非 UI 逻辑测试。执行前检查入口、加载依赖及前后置脚本；不直接执行混合 pnpm check/test、包级全量 test 或带 UI 的 pack/smoke。
- 模型缩写：Luna = `gpt-5.6-luna`，Sol = `gpt-5.6-sol`。子 Agent 必须显式指定这两个模型之一；主 Agent 统一调度和集成，不要求更换当前主模型。
- 派发按完整能力：组件源码、实际辅助、双语词典、样式、既有测试路径和包 README 同属一个 owner。共享 workspace/锁文件、Shell 聚合文件、应用入口和 Spec 进度由主 Agent 写入；Sol 可提供集成方案，不与主 Agent 同时写共享文件。
- [P] 表示前置完成后可与同波次不重叠的任务并行，不表示可以跳过前置。最多使用当前可用子 Agent 槽位；同一能力移交前释放原 owner。
- 下列路径相对仓库根；`S` 仅在证据说明中表示本目录。实施者读最近 AGENTS.md；遇到扩展/UI 归属问题使用对应技能，用户不做 UI 测试的要求继续优先。
- 每项任务的完成条件包括明确的消费者更新、约定范围验证及 evidence。能力任务可交付待集成结果，但共享消费者未接通前不勾选；主 Agent 可执行后续集成来满足这个完成条件，不把“未勾选”误当作无法集成的依赖死锁。

## Phase 1: Setup — 冻结本轮输入

- [x] T001 建立当前包/源/exports/测试/资源和引用清单至 specs/002-client-components-refactor/migration-inventory.json，记录 packages/workbench 六包与直接消费者；模型：主 Agent；前置：无；验证：清单来自当前代码，测试逐文件列出，Spec 001 不变，工作树已有修改单独记录。
- [x] T002 审查 package.json、scripts/run-typescript-tests.mjs、scripts/register-typescript-test-loader.mjs 及 apps/*/package.json 的执行入口，在 specs/002-client-components-refactor/validation.md 记录可执行非 UI 文件/命令、UI 排除列表和初始检查结果；模型：Sol 只读建议、主 Agent 落盘；前置：T001；验证：不运行任何 UI 测试，混合测试及构建钩子已检查，既有失败与新失败可区分。

## Phase 2: Foundational — 迁移合同与写入边界

- [x] T003 补全 specs/002-client-components-refactor/package-map.md 与 migration-inventory.json 的逐文件来源/目标、公开入口、消费者及 helper 消费关系，确认 sidebar、panels、layout、command palette 的互斥写入范围；模型：Sol 研究、主 Agent 写 Spec；前置：T002；验证：src/lib 分工、双语键、样式、既有测试均有唯一 owner，三个新包名称无碰撞。
- [x] T004 在 specs/002-client-components-refactor/contracts/client-components.md 冻结 props、扩展分组、翻译键归属、CSS 聚合顺序和状态/生命周期合同，并在 tasks.md 证据区记录派发边界；模型：Sol、主 Agent 协调；前置：T003；验证：新能力不回引 Shell，contracts 保持环境中立，未借用 Spec 001 的完成结果。

**Checkpoint**：清单与接口已确定，后续可以按能力派发；不创建空壳包作为完成产物。

## Phase 3: US1 — 在 Client 领域定位能力（P1，MVP）

**目标**：六包归入 client，原 name/功能保持。

**独立验收**：workspace 发现新路径、公开入口可解析、frozen-lockfile 安装与受影响类型/边界检查及构建成功；无需 UI。

- [x] T005 [US1] 将 packages/workbench/host-contracts、desktop-contracts、host-client、services-client 移至 packages/client 同名目录，保留 package name、src/lib/tests 和 exports；模型：Luna，完整宿主接入能力组；前置：T004；消费者：所有使用原物理路径的应用/脚本；验证：按 T001 对照文件，契约无新增 DOM/Node 实现依赖，提交物理路径变更清单给 T007。
- [x] T006 [US1] 将 packages/workbench/shell 与 packages/workbench/pi-product 移至 packages/client 同名目录，保持安装与现有公开接口；模型：Sol，应用装配能力组；前置：T005 迁移交付；消费者：Web/Desktop、根脚本及 Pi product；验证：与清单对照无文件/资产/测试遗失，提交消费者清单给 T007，不在本任务拆组件。
- [x] T007 [US1] 同步 pnpm-workspace.yaml、pnpm-lock.yaml、apps/web/src/app/globals.css、apps/desktop-renderer/src/app/globals.css、scripts/check-runtime-host-ownership.mjs 及清单列出的其他路径消费者，移除 workbench glob；模型：主 Agent；前置：T005、T006 迁移交付；验证：锁文件更新及 frozen-lockfile 安装、公开包解析、静态路径扫描通过，历史路径文档不盲改；涉及 Next 配置先读本地指南。
- [x] T008 [US1] 更新 scripts/extension-boundaries.test.ts、scripts/conversation-browser-benchmark.tsx、scripts/serve-conversation-benchmark.mjs 与 apps/web/test 中 T001 识别的路径断言，保留 UI 测试但不执行；模型：Sol 提交补丁、主 Agent 集成；前置：T007；验证：按 T002 精选非 UI 路径/结构检查，benchmark 仅改路径不启动 Browser。
- [x] T009 [US1] 按 specs/002-client-components-refactor/quickstart.md 对六包及直接消费者执行类型、依赖、结构与相关构建检查，将证据写入 validation.md；模型：主 Agent；前置：T008；完成条件：T005–T008 集成完毕、packages/workbench 无活跃包、原包名保持、未执行 UI 测试。

**Checkpoint / MVP**：六包目录迁移独立完成；后续组件拆分可在此稳定状态继续。

## Phase 4: US2 — 独立维护组件能力（P1）

**目标**：三个独立 UI 能力和平台命令面板各有唯一实现，Shell 收窄为应用装配。

**独立验收**：公开接口/类型/依赖检查通过，源码不回引 Shell，既有文件与辅助消费者清单完整；只运行非 UI 逻辑测试。

- [x] T010 [US2] 根据冻结合同拆定 packages/client/shell/src/i18n/messages.ts、runtime.ts 与语言文件的键归属，在 specs/002-client-components-refactor/migration-inventory.json 记录各能力 bundle 和唯一 key owner；模型：Sol 设计、主 Agent 修改共享文件；前置：T009；验证：保持现有 hydration/revision/cookie 与唯一 i18n Context，为 T011–T013 分配互不重叠的源码/测试写入集合；此任务不提前创建空能力包。
- [x] T011 [P] [US2] 将 packages/client/shell/src/sidebar 的线程/工作区列表与排序、lib/thread-sort.ts、src/extensions/workspace-sidebar.ts、src/shell/conversation-actions-menu.tsx 提取到 packages/client/ui-sidebar/{src,lib,tests}，创建 package.json、tsconfig.json、双语 README 与 src/i18n 词典；模型：Luna；前置：T010；消费者：现有 Header/侧栏框架及 Shell 安装目录（T014 集成）；验证：引用统一 i18n、保留稳定 ID、无 Shell 回引，已有测试路径全量迁移，精确筛选排序等非 UI 逻辑用例，src/lib 有真实消费者。
- [x] T012 [P] [US2] 将 packages/client/shell/src/panels 及清单对应辅助/词典/测试提取到 packages/client/ui-panels/{src,lib,tests}，创建 package.json、tsconfig.json 和双语 README；模型：Sol（当前槽位与面板 Host 生命周期边界调整）；前置：T010；消费者：现有框架和后续 ui-layout（T014 集成）；验证：Panel store 仍归 shell-context，TerminalDrawer 为 bottom dock 包装，不反向依赖 terminal-ui/Shell，仅执行静态和非 UI 尺寸逻辑检查。
- [x] T013 [P] [US2] 将 packages/client/shell/src/shell/command-palette-host.tsx 与对应既有测试/实际键盘辅助迁至 packages/extension-platform/host/src 和 lib，通过 package.json 已有 ./command-palette 入口增加组件/props 导出，使用平台词典并更新包 README；模型：Sol；前置：T010；消费者：Shell 全局层（T014 集成）；验证：原入口导出保留、无 Shell i18n 回引、ownerRootRef/受控状态/错误反馈及监听释放静态一致；不执行命令面板 UI 测试。
- [x] T014 [US2] 集成 T011–T013：更新 packages/client/shell/package.json、src/extensions/builtin-extensions.ts、src/i18n 聚合、src/shell 的直接消费者及 pnpm-lock.yaml，通过新 owner 入口接入并删除已迁出实现，更新应用扫描路径与清单；模型：主 Agent；前置：T011–T013 能力交付；验证：三个交付包与 Shell/产品类型、结构/依赖和双语静态检查通过；能力 owner 保留对应文案，默认安装顺序不变，T011–T013 才可勾选。
- [x] T015 [US2] 将 packages/client/shell/src/shell 的剩余 frame/header/global-layer/hydration/resize、src/hosts/statusbar.tsx、sidebar 外框导航/resize 与品牌扩展及区域 CSS 提取到 packages/client/ui-layout/{src,lib,tests}，创建 manifest、tsconfig、双语 README 和 bundle；模型：Sol；前置：T014；消费者：Shell application、Pi product/Web/Desktop（T016 集成）；验证：完整保留 WorkbenchShellProps、Portal、布局观测及释放语义，无 Shell/Pi 产品回引，辅助有实际消费者，UI 测试只迁移不执行。
- [x] T016 [US2] 更新 packages/client/shell/src/application.tsx、src/styles.css、src/i18n、src/extensions/builtin-extensions.ts 和 package.json，以及 packages/client/pi-product、apps/web、apps/desktop-renderer 中全部迁出入口消费者，改用 ui-layout/sidebar/panels/Host 公开入口并删除旧 /workbench、/panels、/hosts/statusbar 转发；模型：主 Agent，Sol 提供契约核对；前置：T015 能力交付；验证：保留 /application、/styles.css，CSS 顺序与副作用标记不丢，types 使用真实 owner，workspace:* 与锁文件同步，T015 才可勾选。
- [x] T017 [US2] 在 specs/002-client-components-refactor/validation.md 记录三个新能力及 Host、Shell、产品和直接消费者的类型/边界/清单结果，静态核对公开 exports 与 src/lib 职责；模型：主 Agent；前置：T016；完成条件：迁出组件只剩唯一实现，无循环、无 Shell i18n 回引、无测试文件丢失，非 UI 用例通过或明确说明不适用。

## Phase 5: US3 — 保持行为兼容（P1）

**目标**：通过本轮允许的静态审查及非 UI 验证核对行为兼容目标，不运行交互场景。

**独立验收**：生命周期/持久化/双语/样式合同有对应源码证据，相关非 UI 验证与构建通过；UI 测试标为 excluded-by-user。

- [x] T018 [US3] 审查 packages/client/shell/src/application.tsx、browser-session-persistence.ts、packages/client/ui-layout/src 与 packages/extension-platform/host/src 的安装、快捷键和销毁接线，及 ui-panels 对 shell-context store 的引用，必要时修复实际偏差；模型：Sol；前置：T017；验证：installation ID、Provider 数量/作用域、事件清理、持久化键、终端生命周期及默认扩展序列不变，提交证据至 validation.md，由主 Agent 合并共享文件修复；不挂载 UI。
- [x] T019 [US3] 静态核对 packages/client/ui-sidebar、ui-panels、ui-layout 的 src/i18n、CSS/module.css 与 packages/client/shell/src/styles.css、两应用 globals.css，必要时修复键/参数、样式归属及资源入口；模型：Luna；前置：T018；验证：双语键一致、唯一 bundle owner、token 随主题/密度/圆角派生、Portal 区域标记和聚合顺序保持，主 Agent 合并共享 CSS 修复；不启动浏览器或视觉/DOM 检查。
- [x] T020 [US3] 根据 specs/002-client-components-refactor/validation.md 的允许清单，运行迁移后的纯排序/存储/端口/编码等相关非 UI 用例及所属源码静态检查，核对 migration-inventory.json 测试路径对应；模型：主 Agent，Luna/Sol 分别处理所属能力失败；前置：T019；验证：精确记录执行文件与结果，UI 文件保留但 excluded-by-user，不为纯 UI 搬迁新增测试。
- [x] T021 [US3] 按 specs/002-client-components-refactor/quickstart.md 执行本轮完整 lint、typecheck、结构/依赖检查和 pnpm build，将 Web/Desktop/Runtime 构建结果与资源路径核对写入 validation.md；模型：主 Agent；前置：T020；验证：检查前后置钩子不触发 UI 测试，禁止混合全量 test/pack/smoke，构建问题修复后只重跑受影响检查，不以构建成功声称 UI 已实测。

## Phase 6: Polish — 清理与最终收敛

- [x] T022 清理 packages/client/shell/package.json 与其余五个迁移包中已无生产消费者的依赖，更新 pnpm-lock.yaml；校准 scripts/check-runtime-host-ownership.mjs、scripts/check-workspace-dependencies.mjs、scripts/check-package-structure.mjs 对新 owner 的约束，必要时调整既有非 UI 结构用例；模型：Sol 提供分析、主 Agent 写共享文件；前置：T021；验证：根据实际 import 删除依赖，不扩宽 allowlist 或恢复迁移基线，相关类型/依赖/结构及受影响构建再验证。
- [x] T023 更新 packages/client 六包和新能力双语 README、最近 AGENTS.md、docs 与 .agents/skills 中活跃旧路径指引，并在 specs/002-client-components-refactor/migration-inventory.json 收口真实清单；模型：Luna 处理能力文档、主 Agent 处理共享文档；前置：T022；验证：真实 src/lib 职责、公开入口、辅助消费者和测试去向可定位，Spec 001 原文件不变，历史快照不盲改。
- [x] T024 对照 specs/002-client-components-refactor/spec.md 的 FR-001–FR-011、SC-001–SC-005 和 contracts/client-components.md 做实际代码收敛核对，在 validation.md 记录证据并更新本 tasks.md；模型：主 Agent；前置：T023；完成条件：缺项修复并完成约定验证、所有任务有证据，UI 排除明确，无新增未授权范围；若仍有未完成工作，追加任务且不得声明完成。

## Dependencies & Execution Order

```text
T001 → T002 → T003 → T004
→ US1: T005 → T006 → T007 → T008 → T009
→ US2: T010 → [T011 | T012 | T013] → T014 → T015 → T016 → T017
→ US3: T018 → T019 → T020 → T021
→ T022 → T023 → T024
```

T005/T006 交付后由 T007 同批接通路径消费者，T011–T013 由 T014 集成，T015 由 T016 集成。上述集成节点依赖能力交付，不依赖能力提前勾选；最终勾选仍要求消费者与验证完成。除这三个明确交付窗口外，前置要求 verified。

三组故事存在真实依赖：US2 依赖 US1 的目录状态，US3 依赖 US2 的最终装配。每组有独立验收界限，不强行为追求并行拆开共享文件。

## Parallel Execution Examples

- **US1**：目录/workspace/锁文件有共享影响，T005–T009 串行；需要加速时允许 Luna 只读核对尚未修改能力的消费者，不能与迁移者写同一目录。
- **US2**：T010 完成后，Luna-A 执行 T011（ui-sidebar），Luna-B 执行 T012（ui-panels），Sol-C 执行 T013（command palette）。三者只写分配文件；Shell i18n、manifest、安装、应用 CSS 与锁文件集中由 T014 写入。三个子 Agent 加主 Agent 不超过当前四槽容量。T015 不与其尚未完成的依赖并行。
- **US3**：生命周期审查 T018 和文案/样式审查 T019 默认串行，避免同时修复 layout。确需并行只能先做只读审查，由主 Agent 排序修复，再执行 T020/T021；不派发 UI 测试任务。

## Requirement Coverage

| 需求                              | 任务                               |
| --------------------------------- | ---------------------------------- |
| FR-001 / SC-001 六包新归属        | T001、T005–T009                    |
| FR-002 / SC-002 组件所有者        | T003–T004、T010–T017               |
| FR-003 双语/样式/测试迁移         | T010–T016、T019–T020               |
| FR-004 复用既有能力               | T003–T004、T011–T016、T024         |
| FR-005 src/lib 与浅目录           | T003、T011–T012、T015、T017、T023  |
| FR-006 公开接口与无环             | T004、T007、T013–T017、T022        |
| FR-007 行为与生命周期             | T004、T013、T015–T016、T018–T020   |
| FR-008 工作区/资源/依赖/文档      | T007–T009、T016、T021–T023         |
| FR-009 / SC-005 独立进度证据      | T001–T002、T009、T017、T024        |
| FR-010 / SC-003–SC-004 非 UI 验证 | T002、T009、T017–T021、T024        |
| FR-011 能力和模型分工             | T003–T004、全清单 owner 与并行规则 |

## Implementation Strategy

先完成 T001–T009，形成只调整领域归属的 MVP；验证通过后继续组件能力拆分，再进行兼容与清理。无需另行确认常规迁移。每个集成窗口保持可复核的改动范围，不强行并行；模型分工不改变能力所有者责任。

已按 speckit-implement 实施本清单；源码、消费者、文档和约定验证一并交付，未提交或发布。

## Evidence Log

实施证据按本轮实际结果记录。执行者每完成一个任务记录 task ID、owner/model、实际文件、消费者、静态/非 UI/build 命令与结果、UI excluded-by-user 范围；详细输出写入本目录 validation.md，避免重复大段日志。验证失败保留未完成状态并注明具体失败，不修改 Spec 001 记录。

- T001–T004 已完成：六包基线与消费者已记录；Sol 完成非 UI 入口审核，静态结构/依赖基线通过，能力/翻译所有权与共享文件写入边界冻结，详见 validation.md。

- T005–T010：Luna/Sol 分别完整迁移六包；主 Agent 同步物理消费者、workspace 和锁文件，冻结能力文案与共享接线。frozen-lockfile 安装、全仓 typecheck、结构/依赖检查、113 项非 UI 宿主/路径测试、2 项 transport owner 守卫测试和完整 Runtime/Web/Electron build 通过。

- 派发调整：历史研究 Agent 占用一个不可释放的会话槽，实际仅可同时运行两位实施子 Agent。Luna 负责 T011；Sol 完成 T013 后接 T012，再按依赖进入 T015。未使用指定之外的子 Agent 模型；接口和消费者完成门槛保持。

- T011–T014：Luna 提取 sidebar，Sol 提取 Host 命令面板与 panels，主 Agent 集成独立 bundles/入口/消费者。五包 typecheck 通过，22 项纯逻辑/静态边界通过；sidebar 66 个、panels 11 个原语义键在双语均逐项保持。首次集成发现并修复 bundle.text API 和 sidebar 命名空间问题，未执行 UI 测试。

- T015–T020：Sol 提取 layout 并完成生命周期、双语和样式静态等价审查；主 Agent 集成实际 owner、修正静态扫描路径和保留 UI 测试路径。最终 202 项明确筛选的非 UI 检查全部通过。
- 执行顺序调整：T022 的依赖清理提前到最终 T021 构建之前，避免对相同最终源码重复构建；清理后重新 frozen-lockfile 安装和全仓检查。Luna 审计其余五包，主 Agent 清理 Shell 并更新共享守卫。

- T021–T024：清理后完整 lint/typecheck/结构/依赖与 Runtime/Web/Desktop 构建通过；63 个原始测试文件映射完整、所有组件目标存在。FR-001–FR-011/SC-001–SC-005 收敛完成，Spec 001 不变，UI excluded-by-user，详见 validation.md。
