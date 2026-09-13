# Tasks: Workbench 领域能力拆包

唯一执行进度清单；所有任务验证后才能勾选。阶段按用户授权的六阶段顺序；每项标注所属维护者场景。未标 [P] 的任务顺序执行。

## Phase 0: 规则与基线（US2、US4）

目标：准确发现违规与测试。独立验证：检查器行为测试及 Spec Kit prerequisite。

- [x] T001 在 `.specify/`、`.agents/skills/speckit-*` 接入现有版本，并写入 `specs/001-workbench-package-refactor/spec.md` 与 constitution；前置无；消费者后续全部技能；验证模板冲突检查、feature.json 与规范完整性检查。
- [x] T002 完成 `plan.md`、`research.md`、`package-map.md`、`contracts/package-boundaries.md`、`quickstart.md`、`tasks.md`（均位于本 Spec）；前置 T001；消费者实现技能；验证 FR-001..012 与 SC-001..007 均有任务覆盖及 prerequisites。
- [x] T003 [US2] 修正 `scripts/check-workspace-dependencies.mjs` 模块/资源引用解析与源码内测试分类；前置 T002；消费者所有包；先增加 fixture 字符串、多种真实导入及 devDependency 测试，再验证现有测试和边界检查。
- [x] T004 [US2] 在 `scripts/run-typescript-tests.mjs` 与依赖检查中增加 tests/ 支持；前置 T003；消费者全部库包；验证旧 test/、src 共置与 tests/ 测试全部发现且不重复。
- [x] T005 [US2] 抽取 `packages/test-support/ui-testkit`（@workbench/ui-testkit），来源 shell/test/react-dom-environment.ts；前置 T004；替换 Shell/Pi/App 跨包测试环境引用；仅声明开发依赖；验证相关 DOM 测试与 package typecheck。
- [x] T006 [US2] 增加 `scripts/check-package-structure.mjs` 与行为测试、精确迁移基线；前置 T005；覆盖包根/嵌套包/src目录/相对导入以及 stale/new baseline；消费者 pnpm check；验证正常与违规 fixture，记录测试发现清单。

## Phase 1: 工作区与工具（US1、US2）

目标：两级包根和不漏测试的发现/构建。独立验证：workspace check、全部类型检查与路径相关测试。

- [x] T007 [US1] 迁移 `packages/agent-runtime/core/*` 到 `packages/agent-runtime/*`、`packages/agent-runtime/runtimes/pi/*` 到 `packages/pi/*`，内嵌 browser 到 `packages/pi/browser`；前置 T006；更新 pnpm-workspace.yaml、配置/导入/文档/技能路径；现有包名保留；验证包清单、lockfile、依赖检查与相关 typecheck。
- [x] T008 [US2] 将全部库包 `test/` 与 src 共置测试迁入所属 `tests/`；前置 T007；同步 tsconfig、fixture 路径、测试辅助与自定义 benchmark 命令；消费者所有测试入口；核对迁移前后测试标识清单，执行测试发现及相关行为测试。
- [x] T009 [US1] 更新 `apps/runtime-node/scripts/build-runtime-artifact.ts`、各 apps 资产/构建脚本、`scripts/*boundary*` 的包定位；前置 T008；Pi技能/提示资源从 src 移至包根并更新公开资源入口；验证资产复制、监听和 build/artifact 相关测试。
- [x] T010 [US3] 验证阶段1的 `pnpm check:workspace-dependencies`、`pnpm typecheck`、路径/测试发现相关测试及 `pnpm build`；前置 T009；记录真实结果，修复迁移引入问题；消费者全部apps。

## Phase 2: 公共基础（US1、US2、US3）

目标：能力包拥有实现、目录合规且公开依赖无环。独立验证：每包及直接消费者 typecheck、相关行为测试、结构/依赖检查。

- [x] T011 [US1] 迁移 `packages/client/settings-runtime`（@workbench/settings-runtime）：shell/src/settings.tsx (remove settings-main-view re-export) → 设置 Context、资源生命周期；前置 T010；更新所有直接消费者、双语 bundle、CSS/exports/dependencies/README/tests；验证该包及消费者 typecheck、相关测试、结构/依赖检查后移除其基线。
- [x] T012 [US1] 迁移 `packages/client/i18n`（@workbench/i18n）：shell/src/i18n runtime/bundle/types/config/provider → 通用翻译运行时、controlled Provider、bundle 注册；前置 T011；基础 runtime 从显式 bundles 组装，controlled Provider；保留 hydrate/revision/Strict Effects 行为于装配，迁移 legacy typed facade；更新所有直接消费者、双语 bundle、CSS/exports/dependencies/README/tests；验证该包及消费者 typecheck、相关测试、结构/依赖检查后移除其基线。
- [x] T013 [US1] 迁移 `packages/client/ui`（@workbench/ui）：shell/src/ui + utils/hooks/resize 的无业务基础能力 → 基础控件、Portal、语义 token；前置 T012；FileLink 与业务菜单归 files；共享 DOM/resize/disclosure 下沉 UI；更新所有直接消费者、双语 bundle、CSS/exports/dependencies/README/tests；验证该包及消费者 typecheck、相关测试、结构/依赖检查后移除其基线。
- [x] T014 [US1] 迁移 `packages/client/appearance`（@workbench/appearance）：shell/src/appearance + 纯 legacy 外观迁移 → 外观偏好、字体、主题状态；前置 T013；更新所有直接消费者、双语 bundle、CSS/exports/dependencies/README/tests；验证该包及消费者 typecheck、相关测试、结构/依赖检查后移除其基线。
- [x] T015 [US1] 迁移 `packages/client/shell-context`（@workbench/shell-context）：shell/src dom/navigation/layout/presentation/runtime-connection/running-indicator → 无业务公共 Context 与显示契约；前置 T014；更新所有直接消费者、双语 bundle、CSS/exports/dependencies/README/tests；验证该包及消费者 typecheck、相关测试、结构/依赖检查后移除其基线。

- [x] T016 [US3] 更新阶段2装配与验证：`packages/workbench/pi-product`、`packages/workbench/shell`、`apps/`；前置 T015；确认公开导出、bundle 与扩展顺序、CSS聚合和资源来源，运行受影响app构建与行为测试，记录结果。

## Phase 3: 前端能力（US1、US2、US3）

目标：能力包拥有实现、目录合规且公开依赖无环。独立验证：每包及直接消费者 typecheck、相关行为测试、结构/依赖检查。

- [x] T017 [US1] 迁移 `packages/client/code-highlighting`（@workbench/code-highlighting）：shell/src/code-highlighting + code block content + elements diff → 高亮、代码表面、编辑器、Diff；前置 T016；共享代码块直接渲染 code，测试反引号/HTML/公式样文本/尾换行/长文本/主题切换，Mermaid 源码不生成图；更新所有直接消费者、双语 bundle、CSS/exports/dependencies/README/tests；验证该包及消费者 typecheck、相关测试、结构/依赖检查后移除其基线。
- [x] T018 [US1] 迁移 `packages/client/markdown`（@workbench/markdown）：shell/src/chat/markdown + markdown-preview + inline-citation → Markdown/公式/Mermaid/预览，链接接口注入；前置 T017；注入统一 MarkdownLinkAdapter（本地 href 判定 + FileLink），异步 pipeline 与 lazy render 均使用同一安装；更新所有直接消费者、双语 bundle、CSS/exports/dependencies/README/tests；验证该包及消费者 typecheck、相关测试、结构/依赖检查后移除其基线。
- [x] T019 [US1] 迁移 `packages/workspace/runtime`（@workbench/workspace-runtime）：shell/src/right-workspace + workspace-directory-store → 控制器、React Host、持久化、反馈；前置 T018；更新所有直接消费者、双语 bundle、CSS/exports/dependencies/README/tests；验证该包及消费者 typecheck、相关测试、结构/依赖检查后移除其基线。
- [x] T020 [US1] 迁移 `packages/workspace/files`（@workbench/workspace-files）：shell/src/workspace-files + workspace-file-tree → 文件服务/缓冲、树、链接能力；前置 T019；FileLinkContextMenu/open-apps/preferences/shared分类随 files，禁止依赖 file-view；更新所有直接消费者、双语 bundle、CSS/exports/dependencies/README/tests；验证该包及消费者 typecheck、相关测试、结构/依赖检查后移除其基线。
- [x] T021 [US1] 迁移 `packages/workspace/file-view`（@workbench/workspace-file-view）：shell/src/extensions/builtin/workspace-file → 文件查看编辑 Surface 与文件菜单；前置 T020；更新所有直接消费者、双语 bundle、CSS/exports/dependencies/README/tests；验证该包及消费者 typecheck、相关测试、结构/依赖检查后移除其基线。
- [x] T022 [US1] 迁移 `packages/workspace/explorer`（@workbench/workspace-explorer）：shell/src/extensions/builtin/workspace-explorer → Explorer Surface；前置 T021；更新所有直接消费者、双语 bundle、CSS/exports/dependencies/README/tests；验证该包及消费者 typecheck、相关测试、结构/依赖检查后移除其基线。
- [x] T023 [US1] 迁移 `packages/workspace/directory-picker`（@workbench/workspace-directory-picker）：shell/src/extensions/builtin/workspace-directory-picker → 目录选择弹层及触发器；前置 T022；更新所有直接消费者、双语 bundle、CSS/exports/dependencies/README/tests；验证该包及消费者 typecheck、相关测试、结构/依赖检查后移除其基线。
- [x] T024 [US1] 迁移 `packages/workspace/artifact`（@workbench/workspace-artifact）：shell/src/extensions/builtin/workspace-artifact → Artifact Surface；前置 T023；更新所有直接消费者、双语 bundle、CSS/exports/dependencies/README/tests；验证该包及消费者 typecheck、相关测试、结构/依赖检查后移除其基线。
- [x] T025 [US1] 迁移 `packages/workspace/review`（@workbench/workspace-review）：shell/src/extensions/builtin/workspace-review → Review Surface；前置 T024；更新所有直接消费者、双语 bundle、CSS/exports/dependencies/README/tests；验证该包及消费者 typecheck、相关测试、结构/依赖检查后移除其基线。
- [x] T026 [US1] 迁移 `packages/workspace/git-branch`（@workbench/workspace-git-branch）：shell/src/extensions/builtin/git-branch → 分支选择、创建及切换；前置 T025；更新所有直接消费者、双语 bundle、CSS/exports/dependencies/README/tests；验证该包及消费者 typecheck、相关测试、结构/依赖检查后移除其基线。
- [x] T027 [US1] 迁移 `packages/workspace/browser`（@workbench/workspace-browser）：shell/src/extensions/builtin/workspace-browser → 浏览器 Surface、设备工具栏、标注；前置 T026；更新所有直接消费者、双语 bundle、CSS/exports/dependencies/README/tests；验证该包及消费者 typecheck、相关测试、结构/依赖检查后移除其基线。
- [x] T052 [US1/US2] 落地用户新增 src/lib 分工：更新 constitution/spec/plan/map/contracts，扩展结构、依赖、测试发现与工具源码扫描；前置 T027；消费者所有包和后续迁移；验证非空 src/lib、lib 深度/相对引用/跨包引用及生产依赖分类行为测试，精确登记新增规则基线。
- [x] T053 [US1/US3] 回迁已提取的 18 个能力包：src 保留公开入口/装配，内部实现/词典/样式进入 lib；前置 T052；更新消费者、tsconfig、Tailwind、资源定位及静态检查源路径；验证各包和直接消费者类型、行为测试、结构/依赖与 app 构建，记录路径映射并移除对应基线。

- [x] T028 [US1] 迁移 `packages/conversation/composer`（@workbench/composer）：shell/src/chat composer-* / workbench-composer* / markdown-composer-input + elements/composer → 输入器、命令、附件与提交；前置 T053；更新所有直接消费者、双语 bundle、CSS/exports/dependencies/README/tests；验证该包及消费者 typecheck、相关测试、结构/依赖检查后移除其基线。
- [x] T054 [US1/US2] 修订 src/lib 职责与 TypeScript 保留规则：更新 constitution 3.1.0、Spec/Plan/模板/研究/边界/检查清单；前置 T028；消费者全部迁移；验证参考包证据、FR-012/SC-007 覆盖，增强结构检查识别全转导出/占位源码并验证 JS fixture；仅登记新增规则造成的精确过渡违规。
- [x] T055 [US1/US3] 重审并修正已迁移 19 包的源码职责：src 放能力实现/契约/组件/装配及共置词典样式，lib 仅留实际使用的辅助模块；前置 T054；更新映射、README/AGENTS、TypeScript 检查范围、消费者和源码扫描；验证包与消费者类型、相关行为测试、边界/结构与应用构建。不得批量生成转导出壳，完成前 T029 不开始。
- [x] T029 [US1] 迁移 `packages/conversation/conversation`（@workbench/conversation）：shell/src/chat 其余对话模块 + elements 消息组件 + message/interactions 扩展 → 消息列表、流式/滚动、消息操作、队列、交互；前置 T055；更新所有直接消费者、双语 bundle、CSS/exports/dependencies/README/tests；验证该包及消费者 typecheck、相关测试、结构/依赖检查后移除其基线。
- [x] T030 [US1] 迁移 `packages/client/terminal-ui`（@workbench/terminal-ui）：shell/src/extensions/builtin/terminal → 终端 Surface、Command、Renderer；前置 T029；更新所有直接消费者、双语 bundle、CSS/exports/dependencies/README/tests；验证该包及消费者 typecheck、相关测试、结构/依赖检查后移除其基线。
- [x] T033 [US1] 迁移 `packages/client/agent-controls`（@workbench/agent-controls）：shell/src/extensions/builtin model-selector/token-usage + model-selector → 通用模型选择与上下文用量；前置 T030；更新所有直接消费者、双语 bundle、CSS/exports/dependencies/README/tests；验证该包及消费者 typecheck、相关测试、结构/依赖检查后移除其基线。
- [x] T031 [US1] 迁移 `packages/client/automation-ui`（@workbench/automation-ui）：shell/src/extensions/builtin/automation → 自动化界面与扩展；前置 T033；更新所有直接消费者、双语 bundle、CSS/exports/dependencies/README/tests；验证该包及消费者 typecheck、相关测试、结构/依赖检查后移除其基线。
- [x] T032 [US1] 迁移 `packages/client/settings-ui`（@workbench/settings-ui）：shell/src/extensions/builtin settings/appearance/locale-selector → 设置/外观/语言界面；前置 T031；更新所有直接消费者、双语 bundle、CSS/exports/dependencies/README/tests；验证该包及消费者 typecheck、相关测试、结构/依赖检查后移除其基线。
- [x] T034 [US1] 迁移 `packages/pi/settings-ui`（@workbench/pi-settings-ui）：pi/contributions/src/extensions agent-configuration/setting-model-config/settings → Pi 模型与 Agent 配置；前置 T032；更新所有直接消费者、双语 bundle、CSS/exports/dependencies/README/tests；验证该包及消费者 typecheck、相关测试、结构/依赖检查后移除其基线。
- [x] T035 [US1] 迁移 `packages/pi/toolbox-ui`（@workbench/pi-toolbox-ui）：pi/contributions/src/extensions toolbox/skill-reading + services → Skills/Extensions/Packages 管理与桥接；前置 T034；更新所有直接消费者、双语 bundle、CSS/exports/dependencies/README/tests；验证该包及消费者 typecheck、相关测试、结构/依赖检查后移除其基线。
- [x] T036 [US1] 迁移 `packages/pi/diagnostics-ui`（@workbench/pi-diagnostics-ui）：pi/contributions/src/extensions context-trace/usage-statistics → Trace 与用量诊断；前置 T035；更新所有直接消费者、双语 bundle、CSS/exports/dependencies/README/tests；验证该包及消费者 typecheck、相关测试、结构/依赖检查后移除其基线。
- [x] T037 [US1] 迁移 `packages/pi/status-ui`（@workbench/pi-status-ui）：pi/contributions/src/extensions about/connection-status + running-indicator → Pi 状态、关于及运行显示；前置 T036；更新所有直接消费者、双语 bundle、CSS/exports/dependencies/README/tests；验证该包及消费者 typecheck、相关测试、结构/依赖检查后移除其基线。
- [x] T038 [US1] 迁移 `packages/pi/session-import-ui`（@workbench/pi-session-import-ui）：pi/contributions/src/extensions/external-session-import → 外部会话导入；前置 T037；更新所有直接消费者、双语 bundle、CSS/exports/dependencies/README/tests；验证该包及消费者 typecheck、相关测试、结构/依赖检查后移除其基线。

- [x] T039 [US3] 更新阶段3装配与验证：`packages/workbench/pi-product`、`packages/workbench/shell`、`apps/`；前置 T038；确认公开导出、bundle 与扩展顺序、CSS聚合和资源来源，运行受影响app构建与行为测试，记录结果。

## Phase 4: Pi 实现（US1、US2、US3）

目标：能力包拥有实现、目录合规且公开依赖无环。独立验证：每包及直接消费者 typecheck、相关行为测试、结构/依赖检查。

- [x] T041 [US1] 迁移 `packages/pi/conversation`（@workbench/pi-conversation）：pi/client/src conversation/messages/context-trace + session-rpc-projection + session-message-accumulator → Pi 纯消息解析、投影与组装；前置 T039；更新所有直接消费者、双语 bundle、CSS/exports/dependencies/README/tests；验证该包及消费者 typecheck、相关测试、结构/依赖检查后移除其基线。
- [x] T040 [US1] 迁移 `packages/pi/transport-client`（@workbench/pi-transport-client）：pi/client/src/transport api/connections/client-transport → HTTP/WS 传输，不含消息物化器；前置 T041；更新所有直接消费者、双语 bundle、CSS/exports/dependencies/README/tests；验证该包及消费者 typecheck、相关测试、结构/依赖检查后移除其基线。
- [x] T042 [US1] 迁移 `packages/pi/server-ports`（@workbench/pi-server-ports）：pi/server 的 Host 绑定类型、会话访问与 stream publisher 接口 → 服务端窄契约；不包含 registry 或 StreamHub 实现；前置 T040；更新所有直接消费者、双语 bundle、CSS/exports/dependencies/README/tests；验证该包及消费者 typecheck、相关测试、结构/依赖检查后移除其基线。
- [x] T043 [US1] 迁移 `packages/pi/model-server`（@workbench/pi-model-server）：pi/server/src/models + agent-runtime/agent-session-services → 模型服务、配置迁移、注入 Trace 观测；前置 T042；Trace观测/trust通过回调注入；保留捕获 hostFetch 与 protectedRuntimes；更新所有直接消费者、双语 bundle、CSS/exports/dependencies/README/tests；验证该包及消费者 typecheck、相关测试、结构/依赖检查后移除其基线。
- [x] T044 [US1] 迁移 `packages/pi/resources-server`（@workbench/pi-resources-server）：pi/server/src resources/skills/packages/extensions/prompts/settings/trust/workspaces/commands + builtin-resources → 资源目录、项目/信任、配置与变更协调；前置 T043；复用现有 Dependencies，去除 registry 默认依赖；单一 mutation coordinator 与锁/重载顺序保持；更新所有直接消费者、双语 bundle、CSS/exports/dependencies/README/tests；验证该包及消费者 typecheck、相关测试、结构/依赖检查后移除其基线。
- [x] T045 [US1] 迁移 `packages/pi/tools`（@workbench/pi-tools）：pi/server/src/internal-extensions → 内置扩展工厂，通过 ports 注入状态与行为；前置 T044；工厂接收 bindings/trace/settings，纯 composer协议归 pi/shared，context trace 最后安装；更新所有直接消费者、双语 bundle、CSS/exports/dependencies/README/tests；验证该包及消费者 typecheck、相关测试、结构/依赖检查后移除其基线。
- [x] T046 [US1] 迁移 `packages/pi/session-server`（@workbench/pi-session-server）：pi/server/src sessions/attachments/imports/automations + execution/thread-store → 会话、历史、附件、导入和执行；前置 T045；publisher 注入，StreamHub留 server，保持 registry/session/SDK stdout实例作用域；更新所有直接消费者、双语 bundle、CSS/exports/dependencies/README/tests；验证该包及消费者 typecheck、相关测试、结构/依赖检查后移除其基线。

- [x] T047 [US3] 更新阶段4装配与验证：`packages/workbench/pi-product`、`packages/workbench/shell`、`apps/`；前置 T046；确认公开导出、bundle 与扩展顺序、CSS聚合和资源来源，运行受影响app构建与行为测试，记录结果。

## Phase 5: 全仓收口（US1、US2、US3、US4）

目标：严格约束和实际行为全部满足。独立验证：完整检查、产物与跨宿主冒烟、converge。

- [x] T048 按 constitution 3.1.0 完成其余库包能力源码/内部辅助分工和 TypeScript 检查覆盖并清零两处超层与相对引用、删除过渡基线及旧 facade；更新 `scripts/check-package-structure.mjs` 严格默认，确认 `package-map.md` 的每项实现存在，所有库包 README/tests 完整；前置 T047；消费者全仓；验证严格结构和依赖检查。
- [x] T049 更新根/领域 `AGENTS.md`、`.agents/skills/`、`docs/` 与仓库说明中的所有权/路径；前置 T048；消费者未来开发者；验证无陈旧生产路径，原组件细则随能力迁移且不复制回根。
- [x] T050 执行 `pnpm check`、`pnpm build`、现有 Runtime/Electron artifact/native smoke 与 Web/Desktop 集成冒烟；前置 T049；消费者四个apps；覆盖会话/流式取消/Composer/文件/Git/浏览器/终端/i18n外观/Pi资源，失败修复后记录命令和结果。
- [x] T051 通过 `$speckit-converge` 对照 `spec.md`、`plan.md`、`tasks.md` 检查实际代码与产物；前置 T050；对缺项追加独立任务并继续 implement，直到 FR/SC/所有权无缺口；验证无未完成验收且前置脚本仍定位本Spec。

## Dependencies & Execution Order

阶段0 → 1 → 2 → 3 → 4 → 5。每项前置为文本中明确的任务编号。每个包的消费者迁移与实现必须在同一任务完成。技术上独立的检查可批量运行；共享源码与lockfile修改顺序执行，当前清单不标并行实现任务。

## 验证证据与当前状态

- T001：Specify CLI 0.12.5.dev0 在临时目录初始化；仅合并不存在的文件，工作区原有文件未覆盖。constitution 1.0.0 与规范检查已完成。
- 待执行项目不作完成声明；所有后续命令结果在此按任务编号追加。

- T002：一致性分析确认 FR-001/002/004/009 → T006/007/048，FR-003 → T003/各能力迁移/048，FR-005/007 → T011–047，FR-006 → T004/008，FR-008 → 各阶段 gate/T050，FR-010 → T001/002/051；SC 均由 T048–051 验收。prerequisites 返回本 Spec，任务编号和依赖顺序完整。
- T003/T004：21 项解析器/依赖边界/测试发现行为测试通过；全仓依赖边界检查通过。根开发工具使用 oxc-parser；修复 Runtime 生产契约依赖归类，PNG 文件断言归属 renderer，Electron 保留打包配置断言。
- 预存验收问题（进入 T010 修复）：广泛运行 Shell 测试发现 4 项失败，涉及 trust fixture 的 requiresTrust 值、浏览器错误文案旧预期、DOM IDREF 检查误判自定义组件 id，以及 public exports 清单漏 directory-picker。实际业务文件尚未修改，后续按现有契约校准后复验。

- T005：5 个测试消费者改用 @workbench/ui-testkit 开发依赖，三份相同 DOM helper 合并；88 项相关行为测试通过，ui-testkit typecheck 通过，原全局属性描述符恢复及嵌套环境隔离测试通过。
- T006：结构检查的 3 项行为测试通过，接入 pnpm check。基线捕获 35 库包、520 测试文件、1439 个精确违规（11 包根、1 内嵌包、557 src 深度、351 超层引用、519 测试位置）；test-inventory.json 保存迁移前清单。新增与失效基线均失败，prune 只能删除已修复条目。

- T007：11 个库包移至两级根，包名保持，workspace/lockfile/技能/配置/构建定位同步；root-migrations.json 保留对应关系。结构检查包根与内嵌包违规清零，依赖检查通过；已迁移包 typecheck 通过。Pi contributions 暴露既有 Shell SVG ambient 声明未随公共入口加载的问题，已由 UI 公开类型入口引用声明修复并复验。
- 基线校准：上述 4 项 Shell 失败已按实际契约修正测试（false trust 可在资源禁用下打开，promptRequired 才阻止进入；当前中英文错误文案；只检查原生 DOM 标签；补齐 directory-picker 入口），10 项相关测试通过。

- T008：527 个测试及辅助文件移入 tests/，原 520 个测试文件逐项映射后仍为 520，无遗漏/新增重复；test-migrations.json 保存映射。所有库包 typecheck 通过；完整包测试发现的迁移路径问题和原有断言偏差均已修复，14 个受影响文件的 106 项复验全部通过。artifact-policy 改用统一扫描器，避免旧 glob 静默执行 0 项。
- Phase 1 测试校准：Pi 隐藏扩展清单补 workspace-review，浏览器命令保留 threadId，模型默认值比较纳入初始化后的内置包注册，技能列表 fixture 使用独立 agentDir 防止开发环境内置技能干扰；Pi SVG 片段 ID 按当前 maskId 验证。根测试已通过，旧 FileLink/menu 与 Review/image classifier 两处耦合有精确过渡预期，T020 必须移除。

- T009：Pi skills/prompts 移至包根 resources/，Browser 实现归 src/；构建显式区分源码和产物资源 URL，产物路径仍为 internal-skills/internal-prompts/internal-extensions/internal-packages/browser。Runtime artifact 资源安装/裁剪测试、Browser 源码和打包加载测试、内置资源测试通过；三个受影响包/应用 typecheck 通过，Python extension creator 与 skill installer 离线测试通过。

- T010：pnpm build 成功构建 Runtime、Web、Desktop renderer 和 Electron Runtime 组合；pnpm typecheck 全仓通过；pnpm test:root 的 92 项测试通过；结构和依赖检查通过。

- T011：settings-runtime 已拥有设置 Context、固定端口、安装级资源缓存与释放生命周期；51 个源码/测试消费者改用公开入口。设置页面请求保持 Shell 的独立 settings-view 入口，基础包不导出页面。新包及四个直接消费者 typecheck 通过，106 项相关测试通过，结构/依赖检查通过。

- T012：@workbench/i18n 拥有空基础 catalog、显式 bundle、描述符校验、格式化和受控 Provider；Shell 使用单一 Context 的类型化 facade 并保留设置/cookie hydration，Pi 改用共享 runtime。三个基础行为测试、24 项 Shell/架构集成测试通过，Pi UI 134 项通过/1 项原有跳过；基础包、Shell、Pi UI、Product typecheck 通过，结构/依赖检查通过。

- T013：@workbench/ui 拥有无业务控件、Portal、尺寸调整、剪贴板和折叠滚动，公开样式入口保持原级联顺序；211 个文件引用已更新，Web/Desktop Tailwind 扫描包含 client 包。UI 的 54 项、Shell 的 644 项及根 92 项测试通过，UI 与四个消费者 typecheck 通过，结构/依赖检查通过。FileLink 暂留 Shell，按 T020 归 files。

- T014：appearance 包完成偏好、字体与安装级存储迁移，仅提取纯旧外观字段读取；25 个文件引用更新。22 项包测试及 Shell 622 项测试通过，包与 Shell/Desktop typecheck、结构/依赖检查通过；持久化格式和异步 hydration/dispose 行为保持。

- T015：shell-context 完成 DOM、导航、展示、固定 Runtime 连接、布局策略/读取信号及指示器契约迁移，77 个文件引用更新。Shell 保留布局运动观察器，Product 拥有具体动画目录。Context 14 项、Shell 608 项、Pi UI 134 项（原有 1 项跳过）、Product 6 项和根 92 项测试通过，六个相关包/应用 typecheck、结构/依赖检查通过。
- T016：阶段 2 的完整 pnpm build 通过，Runtime、Web、Desktop renderer 和 Electron Runtime 产物组合成功；CSS 公开入口与 Tailwind 源扫描通过真实应用构建验证。

- T017：code-highlighting 拥有直接源码显示、流式 Shiki、编辑器和 Diff；保留标题栏/展开/滚动/CSS。14 项包测试覆盖反引号/HTML/公式样文本/空白及尾换行/长文本/Mermaid 源码、挂载后主题切换及双语复数。Shell 598 项、Pi UI 134 项和根 92 项测试通过；包与消费者 typecheck、结构/依赖检查通过。

- T018：Markdown/GFM/公式/Mermaid/引用/预览和网站图标归 markdown，Product 注入固定的文件链接判定/组件对；解析与延迟渲染共用 Context。15 项包测试覆盖异步加载双安装隔离、固定适配器和过滤；Shell 行为测试通过（两项源路径/入口清单检查修正后 6 项复验通过），Product 6 项及根 92 项通过，包/消费者 typecheck、结构/依赖检查通过。翻译 bundle 入口保持无 React，组件 Hook 独立。

- T019：workspace-runtime 拥有控制器、持久化、Surface/反馈生命周期、React Host、标签页及目录状态；103 个文件引用更新。浏览器通过只读 store 与 controller 公开接口访问，内部 Environment 不导出。78 项包测试、Shell 509 项、Pi UI 134 项（原有 1 项跳过）、Product 6 项和根 92 项测试通过；四包 typecheck、结构/依赖检查通过。

- T020：files 拥有服务/缓冲/树/图标/FileLink 菜单/应用偏好/下载与 Markdown 适配器；文件分类同时供 Review 使用，两处过渡耦合预期删除。32 项文件测试、UI 54 项、Shell 477 项、Pi UI 134 项和 Product 6 项测试通过，根 92 项通过；相关类型与结构/依赖检查通过。

- T021：文件查看器与资源租约完整迁入 file-view，35 项包测试、files 33 项、Shell 439 项及根 92 项测试通过；包与 Shell typecheck、依赖和结构检查通过。扩展 ID、打开器、标签替换策略及资源释放保持。

- T022：Explorer 实现、运行时策略和词典迁至 explorer，文件树文案使用 files bundle。Explorer 3 项、Shell 436 项和根 92 项测试通过；包与 Shell 类型、结构/依赖检查通过。

- T023：目录选择器实现与 workspaceDirectory 词典独立，新建会话的纯工作区选择策略随能力迁入。目录选择器 9 项、files 43 项、Shell 419 项、根 92 项测试通过；自动化消费者调整后 7 项复验通过，包/Shell 类型及边界检查通过。

- T024：Artifact 预览服务、运行时桥接与渲染器归 artifact，词典独立且保留安装资源缓存。2 项包测试、Shell 417 项和根 92 项测试通过；包/Shell 类型、结构和依赖检查通过。

- T025：Review 实现、词典和作用域样式独立，保留 Diff 请求去重、取消、分页及仓库变更失效逻辑。4 项包测试、Shell 413 项和根 92 项测试通过；包/Shell 类型、结构/依赖检查通过。

- T026：Git 分支选择/创建/切换、提交图及状态总线归 git-branch；5 项包测试、Shell 408 项与根 92 项通过，包/Shell 类型和结构/依赖检查通过。
- T027 实施依赖调整：先迁入 T032 的设置视图请求和标题到 settings-ui/request，避免 Browser 反向依赖 Shell；T032 的其余设置界面尚未完成。安装级通用 Panel Store 补归 shell-context，Browser 集成测试复用同一实现。

- T027：浏览器服务、Surface、设置、输入、下载与标注及词典/样式迁入 browser；Browser 22 项、shell-context 15 项、Shell 385 项、Pi UI 134 项（原有 1 项跳过）、Product 6 项和根 92 项通过。旧文件路径与描述符工厂更新后 24 项集成复验通过，六个相关包类型、结构/依赖检查通过。

- 用户新增约束已确认：lib 为手写内部源码；constitution 升级 2.0.0。历史 T001–T027 验证证据不撤销，但其结构结果由 T052/T053 按新规范复核，最终收口不能沿用旧 src-only 判断。FR-011/SC-006 由 T052/T053/各后续迁移/T048/T050/T051 覆盖。

- T052：constitution 2.0.0、FR-011/SC-006 与任务依赖已同步；结构检查要求实际 src/lib、浅目录与 src 公开入口，依赖及测试发现覆盖 lib，类型配置/Tailwind/架构源码扫描已扩展。22 项相关行为测试及根 94 项通过，依赖检查通过；只将新增规则识别的 52 个缺 lib 旧布局登记进基线，其他 315 项原始违规未扩张。

- T053：18 个已提取能力包的 360 个实现文件迁入 lib，86 个公开入口留在 src，src-lib-migrations.json 保存逐文件映射。能力测试 327 项、Shell 385 项、Pi UI 134 项（原有 1 项跳过）、Product 6 项与根 94 项通过；全仓类型检查、结构/依赖及完整 pnpm build（Web、Desktop renderer、Runtime/Electron 组合）通过。旧源码静态检查路径已同步。尚有 34 个原有库包的 lib 分工由后续任务/T048 完成，相关基线保留。

- T028：Composer 的 36 个实现/词典/样式文件在 lib，13 个公开入口在 src；文档解析、旧指令兼容、输入历史、附件与提交保持，消息渲染留 T029。67 项 Composer 测试、settings-runtime 4 项、Shell 315 项、Pi UI 134 项与 Product 6 项通过，根 94 项通过；五包类型及结构/依赖检查通过。workspace/Tailwind 纳入 conversation 领域，CSS 入口保留原级联顺序。

- 用户再次修订约束：src 不得全为导出壳，按两个参考包的真实能力源码组织 src；参考包 lib 实为构建输出的事实已记录，继续沿用此前用户明确的手写 lib 定义，按内部辅助职责收窄。简单辅助模块优先 JS。T053/T028 是旧规则下的历史证据，T055 未通过前不视为满足新版分工。

- T054：constitution 3.1.0 与 FR-012/SC-007、相关模板/约束已同步；结构检查识别全转导出和注释/空 export 占位，JS 适用相同边界。6 项检查器测试及根 96 项通过，Spec Kit prerequisites 正常。仅新增 19 条实际 source-role 过渡违规，原基线未扩大；由 T055 清除。

- 用户最终语言约束：保留 TS/TSX，不使用 JS 改写辅助模块。T055 撤回 4 个试行 JS 文件与为此新增的类型配置；src/lib 职责修正继续执行。此前 JS 提议仅为历史，已失效。

- T055：19 个已迁移包按真实能力/内部辅助重新分工，source-role-migrations.json 和 source-role-review.md 记录实现路径与消费者；19 条全转导出违规清除。按用户最终要求 4 个试行 JS helper 及新增配置全部撤回，保留 TS/TSX。397 项能力测试、Shell 315 项、Pi UI 134 项（原有 1 项跳过）、Product 6 项和根 96 项通过；全仓 typecheck、结构/依赖检查及完整 pnpm build（Runtime、Web、Desktop renderer 与 Electron Runtime 组合）通过。源码路径检查和词典/样式归属已同步。

- T029：Conversation 的消息渲染、滚动、8 组扩展及词典/样式迁入新包，src 放真实能力，lib 放投影/布局/策略辅助，统一 TS/TSX。导航策略、时长格式化、工具偏好分别归 shell-context/i18n/settings-runtime 的公开入口；Shell 的 chat/elements/title facade 删除，Pi/Product 改用所属 bundle。143 项 Conversation 测试、Shell 164 项、Pi UI 134 项（原有 1 项跳过）、Product 6 项与根 96 项通过；全仓 typecheck、结构/依赖检查通过。库包 54 个、测试文件仍 531 个、迁移基线降至 257 项；阶段 3 构建由 T039 统一验证。

- T030：终端界面、服务/目标契约、命令与 Bash Renderer 归 terminal-ui/src，记录/状态/尺寸辅助归 lib，保持 TS/TSX。15 项终端、Shell 149 项、Pi UI 134 项（原有 1 项跳过）、Product 6 项及根 96 项通过；相关四包 typecheck 与结构/依赖检查通过，基线降至 231 项。
- Phase 3 顺序校准：Automation 依赖通用 model-selector-state/reasoning-effort-label 与模型文案，先执行 T033（前置 T030），再 T031、T032、T034；同一阶段内按实际依赖调整，能力边界和任务 ID 保持。

- T033：Agent Controls 拥有通用模型选择和上下文/用量界面，src 放组件、状态、装配和词典，lib 放模型映射/推理标签/动画/吞吐辅助；自动化通过其公开模型 API 与 translator 复用文案。21 项包测试、Terminal 15 项、Shell 128 项、Pi UI 134 项（原有 1 项跳过）、Product 6 项及根 96 项通过；四包 typecheck、结构/依赖通过，基线降至 217 项。

- T031：自动化表单、主页、侧栏和扩展装配归 automation-ui/src，调度/焦点/保存错误/信任文案与注册释放辅助归 lib，均为 TS/TSX。自动化 7 项、Shell 121 项、Pi UI 134 项（原有 1 项跳过）、Product 6 项与根 96 项测试通过；四包类型及结构/依赖检查通过，剩余基线 204 项。

- T032：settings-ui 已拥有设置/外观/语言界面、背景图状态及完整共置词典；lib 保留语言名与页面默认值辅助，TS/TSX 分工通过。纯运行指示器归公共 UI，消除 Conversation 与 Settings 的依赖环。Settings 11 项、UI 54 项、Conversation 143 项、Shell 110 项、Pi UI 134 项（原有 1 项跳过）、Product 6 项及根 96 项通过，六包类型及结构/依赖检查通过，剩余基线 173 项。

- T034：Pi Settings UI 拥有模型/Agent 配置、缓存提示及配置文件操作，词典使用独立中性 bundle；产品聚合安装 bundle 列表保持扩展顺序，Toolbox 的系统提示词标题通过公开入口使用该词典。Pi Settings 39 项通过/原有浏览器检查 1 项跳过，Pi contributions 95 项、Product 6 项及根 96 项通过；三包类型、结构/依赖检查通过，剩余基线 156 项。Web/Desktop Tailwind 扫描扩展至 Pi 领域各能力的 src/lib。

- T035：Toolbox 的资源管理/提示词界面、读取技能展示和文件 backend/opener/Provider 归 pi/toolbox-ui；内部草稿、scope、更新反馈和技能状态投影放 lib。54 项包测试、Pi contributions 41 项、Product 6 项与根 96 项通过；三包类型、结构/依赖检查通过，剩余基线 130 项。

- T036：Trace/用量诊断界面归 pi/diagnostics-ui，缓存、投影、查询、时间轴布局和统计辅助归 lib。31 项包测试、Pi contributions 10 项、Product 6 项及根 96 项通过；三包类型、结构/依赖检查通过，剩余基线 105 项。产品级翻译测试使用完整已安装 bundle 集合。

- T037：Pi 状态/关于及四种持久化运行指示器归 status-ui，字标像素几何作为 lib 辅助数据，UI 仍使用安装级 DOM ID/branding Context。Status 3 项、Pi contributions 7 项、Product 6 项和根 96 项通过；三包类型与结构/依赖检查通过，剩余基线 98 项。DOM 守卫扩展扫描各 Pi UI 包的 src/lib。

- T038：会话扫描/选择/导入界面归 session-import-ui，lib 拥有稳定选择键和批量限制；外部导入仍未加入默认安装列表。1 项包测试、Pi contributions 6 项、Product 6 项及根 96 项通过；三包类型、结构/依赖检查通过，剩余基线 95 项。

- T039：全仓 pnpm typecheck 和 pnpm build 通过，Runtime、Web、Desktop renderer 与 Electron Runtime 产物组合成功。消息索引 CSS 新增公开入口并保持原聚合位置；新包 lint 通过。构建沿用 CSS Highlight API 的既有解析警告，其原有 opt-in 浏览器测试由 T050 的集成验证执行。
- 阶段 4 顺序校准：WebSocket 的 frame 处理直接使用 SessionMessageAccumulator，因此先执行纯消息包 T041，再执行传输 T040（T042 接 T040），避免临时依赖 client 形成环。

- T041：纯 Pi 消息契约/解析/投影/累积器/队列与组装器归 pi/conversation，lib 放事件/token/用量/时序/统计辅助。107 项包测试、Pi client 200 项（含 manager + assembler 集成）、Pi contributions 6 项、Product 6 项和根 96 项通过；四包类型、结构/依赖检查通过。

- T040：HTTP/RPC、传输快照及双 WebSocket 控制器归 transport-client/src，lib 在分发前解析/校验帧；消息累积器通过 pi-conversation 的公开入口复用。连接 11 项、Pi client 189 项、Pi contributions 6 项、Product 6 项与根 96 项通过；四包类型、结构/依赖检查通过，消息重放/重连/generation/watermark/gap 测试保持。

- T042：server-ports 拥有 Host/工具偏好、扩展 UI、窄会话访问与 StreamPublisher 契约；实际 Host binding/StreamHub 仍由 server 持有，lib 提取已消费的偏好回退。2 项 ports 测试、38 项工具/交互/资源变更/流测试、根 96 项通过；ports/server/runtime-node 类型及结构/依赖检查通过，测试文件现 532 个。

- T043：model-server 拥有模型服务/配置存储/SDK services，lib 保留图片输入探针；Host 显式传入项目信任及请求时的观测查找端口。hostFetch 捕获、protectedRuntimes、SDK runtime/认证/deferred 实例语义保持。配置 13 项、模型/Trace/传输/RPC 集成 66 项与根 96 项通过；四包类型和结构/依赖检查通过。

- T044：资源业务及持久化迁入 pi/resources-server，消费型路径/命名/读取/元数据辅助模块归 lib。服务端 resource-composition 选择原共享缓存、变更协调器、会话配置、工具目录和工作区发布器；PiServerError 统一归 ports，异常身份保持。14 项包测试、163 项资源/工作区/设置集成测试及相关三包/app 类型检查通过；根边界测试按注入后的所有权更新，96 项通过。资源构建源定位随所有者更新。
- T045：内置工具业务工厂和 Todo 状态归 pi/tools/src，开关订阅/序列化/历史迁移辅助归 lib。工厂通过 WorkbenchToolDependencies 和 PiToolContextTrace 接受原会话与宿主能力；原工具 IDs/安装顺序保持，context trace 最后安装。纯 Composer 模型输入协议归 pi/shared。14 项工具测试、23 项扩展/模型传输/资源/配置集成测试、96 项根测试通过，ports/shared/tools/server/Runtime 类型及依赖检查通过；结构基线降至 72 项。Runtime 的工具源码快照按 src/lib/resources 三个明确目录复制。

- T046：会话、附件、导入、自动化、历史/用量/Trace 服务和 Agent execution/thread-store 迁入 pi/session-server。createPiSessionRegistry 由 server/session-composition/registry 在每个模块代际创建一次，仍保留原进程注册表、缓存、SDK 会话生命周期与关闭钩子；交互注册表保留 Symbol.for 标识，接收相同 publisher。各既有 Dependencies 的默认选择移到服务端装配，历史替代源的 branches/resume 回退规则保持。40 项包测试通过；服务端 545 项中行为测试通过，唯一旧资源树断言修正后所属 10 项测试通过；96 项根测试、全仓类型及依赖检查通过，测试库存仍 532 文件。
- T047：完整 pnpm typecheck 和 pnpm build 通过。Runtime、Web、Desktop renderer 与 Electron Runtime 组合成功；源码引用和工具资源快照随能力所有者定位。现有 CSS Highlight 解析警告仍待 T050 的原有原生浏览器测试核对。

- T048：69 个库包均有实际 src/lib、根 tests 与中英文 README；34 个原有包按消费辅助职责完成 TS 分工。最后的 routes、Shell 词典和本机应用模块已压平，私有转发入口删除。结构检查默认严格、过渡基线已删除，跨包 tests 动态导入亦验证公开 exports，workspace 版本必须精确 `workspace:*`。严格结构/依赖为零，根 97 项通过；全仓类型检查通过。新增两份归属测试后库存 534 文件。
- T049：更新根说明、Pi 架构、扩展和 i18n 指引及 SDK/扩展技能中的能力所有者与路径；旧完成计划标为历史快照并链接当前映射。package-inventory.json 给出 69 包实际 exports、src/lib 与 tests 清单。Shell 词典细则使用浅目录语言文件，新增能力示例按两级包根与 TS 分工组织。

- T050：完整 `pnpm check` 通过（2,996 tests，2,989 pass，0 fail，7 原有条件 skip）；其中提示词 CSS Highlight 已单独在真实 Chrome 验证通过，其余为平台/工具条件测试。完整 `pnpm build` 通过 Runtime、Web、Desktop renderer 和 Electron 组合。Node 与 Electron native smoke、Web standalone HTTP 200、Electron `run pack` 全部通过；pack 包含 staged API host 和实际 Window/RPC/Pi 双 WS/PTY/标题栏/重启/清理/预算检查。Web 隔离状态实测添加工作区、创建/恢复会话、打开终端并执行本机标记命令、内嵌浏览器加载本机页面、双语切换/重载与主题切换；作用域脚本验证两安装隔离、区域控件、Portal 圆角、滚动条和 resize 动画。流式取消、Composer、文件/Git、Pi模型配置和资源重载由全仓相关行为/集成测试覆盖；没有付费模型请求。
- T050 修复证据：原生 Node 消费的三个 TS 入口增加 `.ts` 扩展名并启用现有 noEmit 体系的 allowImportingTsExtensions，删除两处失效 TS5097 抑制；能力语言保持 TS/TSX。过期架构断言改为当前路径/装配注入与实际公开入口，扩展清单补回 HEAD 已存在的 usage-statistics/skill-reading；生命周期版本仍是原有 7。原 Highlight/样式脚本的过期数量、图标档位及 token 断言按原有产品源码修正，产品样式与高亮实现未改行为。详细验收见 validation.md。

- T051：Spec Kit converge 已核对实际代码、manifest、测试/辅助引用清单及验收证据：12 FR、7 SC、4 组用户场景、8 项架构决策与 5 条 constitution 原则均有实现与验证。missing/partial/contradicts/unrequested 均为零，无需追加任务；converge 保持 tasks 字节不变后，由实施流程记录本任务完成。全部 55 个任务完成，172 辅助模块均有消费者，69 包清单无漂移；最终 Electron pack 复验通过，隔离冒烟进程全部清理。
