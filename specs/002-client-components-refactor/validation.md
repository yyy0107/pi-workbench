# Spec 002 实施验证

## 初始状态

- 初始改动仅为本轮规划文档、AGENTS.md 和 .specify/feature.json；未覆盖其他源码修改。
- Spec 002 无 checklists/、无 extensions.yml hooks。现有 .gitignore 覆盖依赖、构建、环境与 tsbuildinfo；本轮不发布包，无需 .npmignore。
- T001：migration-inventory.json 记录六包原 name/exports/dependencies、181 个受控文件、测试与消费者。
- UI 测试、UI 自动化和手工 UI 冒烟全部 excluded-by-user。

## T002–T004

- Sol 只读审查 runner 和脚本：包级 test 无文件筛选，会混入 UI。选定非 UI 用例使用 `node --no-warnings=ExperimentalWarning --import ./scripts/register-typescript-test-loader.mjs --test <明确文件>`。
- 四个宿主/契约包的 tests 为解析/契约/假传输非 UI 用例；Shell 仅选纯排序、move、order-store、目录存储和源码静态边界。所有 TSX、fake DOM resize/layout-motion/window-resize、drag-session 和 public-exports 导入组件图均排除。
- root build 仅执行受控产物清理、资源同步、Runtime/Web/Electron 构建及 artifact 组合，未发现测试钩子。禁止 pack/smoke/dev/start。
- 初始 `pnpm check:workspace-dependencies` 与 `pnpm check:package-structure` 通过：69 库包、534 测试文件、0 违规。
- T003/T004：冻结组件映射、bundle 归属及现有 props/顺序/存储合同；workspace 标题键 workbench.shell.workspace 归 sidebar，与 Header 共享 sidebar bundle，避免 sidebar 依赖 layout。其余 workbench.shell 键归 layout。Panel 与命令面板依既有公共 store/service；Shell i18n/安装/CSS 共享文件仅主 Agent 写入。

## 目录迁移 T005–T010

六包原文件与 exports 保持，消费者、Tailwind、lint 与架构脚本路径已同步；工作区 frozen-lockfile 安装通过。全仓 typecheck、结构/依赖检查通过，69 库包、534 测试文件无遗漏。

精确 Node loader 命令执行四宿主/契约包 tests/*.test.ts 和 scripts/extension-boundaries.test.ts：113 pass。scripts/check-runtime-host-ownership.test.mjs：2 pass。因 host-client 现进入 client 扫描，检查器仅承认 runtime-websocket.ts 这一实际底层 native socket owner，普通 Client 文件仍禁止直接 new WebSocket；没有放宽整个包或目录。

pnpm build 成功：Runtime Node、Web、Desktop renderer、Electron Runtime artifact 组合全部完成。未执行 UI 测试/交互冒烟。原始日志 /tmp/spec002-build-move.log、/tmp/spec002-move-types.log、/tmp/spec002-move-tests.log。

## 能力提取 T011–T014

Luna ui-sidebar，Sol Extension Host command palette/ui-panels，主 Agent 集成。五包（Host/sidebar/panels/Shell/Pi product）typecheck 通过；22 项排序、order-store、move 与纯文件包边界检查通过。新包 public-source-entry 检查严格保持，取消直接 lib export。

Node loader 静态加载双语 catalogs 与 HEAD 原始字典逐项比较：sidebar 66 原语义键、panels 11 原语义键均完整保持（每种语言）。首次检查暴露 sidebar 被缩短的命名空间与 bundle 不提供 text 的 API 差异，已修正后重验通过。71 库包、535 测试文件；增加一项非 UI panels 包边界用例，其余已有测试随 owner 保留。

日志 /tmp/spec002-components-types.log、/tmp/spec002-components-tests.log；/tmp/spec002-check-catalogs.mjs 为只读 catalog 核对。UI 测试继续 excluded-by-user。

## Layout 集成与兼容审查 T015–T019

Sol 完整迁移 ui-layout；主 Agent 将 application/消费者改用真实 owner，删除 Shell /workbench、/panels、/hosts/statusbar 转发。Shell 保留 application、browser-session-persistence、extensions、i18n、i18n/runtime 和 styles.css 六个公开入口。72 库包、535 个测试文件、0 结构违规，全仓类型检查通过。

Sol 对照 HEAD 静态审查确认：WorkbenchShell 的 state/effect/deps/清理/JSX 与原实现一致，Provider 顺序（Lucide → DOM IDs → presentation → Portal → scroll → running indicator → Sidebar）不变；global layer 顺序、ownerRootRef、Mod+K、快捷键订阅与错误反馈不变。installation ID 的 state 初始化、服务身份、draft/scroll 存储键及异常回退保持；Panel 默认尺寸/resize 清理、底部 TerminalDrawer 与终端生命周期所有权保持。

双语逐叶核对 sidebar 66、panels 11、layout 3 个完整语义键，静态文案/值类型/插值参数和采样函数输出与 HEAD 相同。layout CSS 和导航 module.css 原样迁移；Shell aggregate 在原位置引入 layout CSS，tokens 仍最后导入。两应用继续统一 Shell styles，Client source globs 覆盖新包。Portal 区域与现有主题、密度、圆角 token 消费保持。审查没有渲染 UI。

## 最终非 UI 执行 T020

精确 Node loader 运行 202 项测试，202 pass、0 fail。覆盖四宿主/契约包、sidebar 纯 move/reorder/group/index/order-store/sort、panels 静态包边界、Shell 源码边界/存储/比例尺寸/词典、Pi 设置和运行指示器目录、agent-runtime backend-neutral 消费者、根 workspace/包结构/依赖/runtime-owner/extension/architecture/path 规则。完整文件列表见 non-ui-test-files.json；运行形式为 `node --no-warnings=ExperimentalWarning --import ./scripts/register-typescript-test-loader.mjs --test <列表文件>`，日志 /tmp/spec002-final-tests.log。

UI 文件全部保留，修正移动后的 import 和源码读取路径；未运行任何 UI 测试、fake DOM、渲染快照、Browser、Electron 自动化或手工 UI 冒烟。所有这类验证为 excluded-by-user。

## 依赖与文档 T022–T023

按实际 src/lib/import/CSS 消费删除 Shell 50 个无用生产依赖，4 个仅测试所用依赖归 devDependencies；其余五个迁移包依赖均有实际消费。明细写入 migration-inventory.json。清理后 lockfile-only 和 frozen-lockfile 安装通过。原生 WebSocket allowlist 仅包含实际底层工厂文件，新增正反例静态检查，未放宽 Client 通用规则。oxlint 对三个新包保持 Host hooks / Pi / Next / Node 边界并新增禁止回引 Shell/product。

Luna 更新 Shell 双语 README，三个新包与 Host 文档随能力维护；主 Agent 同步当前 docs、skills、AGENTS 路径。历史计划快照保留原路径，Spec 001 diff 为空。清单记录原始文件与所有测试的最终去向、exports 和依赖，不以删除既有测试实现数量收敛。

## 最终检查与收敛 T021–T024

- `pnpm lint`：通过；最初 5 个格式问题已整理后复验通过。
- `pnpm check:workspace-dependencies`：通过，包含 Runtime owner 边界。
- `pnpm check:package-structure`：72 库包、535 测试文件、0 违规。
- 清理依赖后 `pnpm typecheck`：apps 和 packages 全部通过，日志 /tmp/spec002-post-cleanup-types.log。
- `pnpm build`：Runtime Node、Web、Desktop renderer 和 Electron Runtime 组合全部完成，exit 0，日志 /tmp/spec002-final-build.log。原有 Pi settings `::highlight(pi-prompt-placeholder)` Turbopack CSS 解析 warning 仍存在，与目录迁移阶段日志一致；本轮未改该样式。
- `git diff --check`：通过；Spec 001 diff 为空。
- 六个原包共 63 个原始测试文件全部映射到存在的新路径；componentMapping 所有目标存在；packages/workbench 活跃 manifest 为 0。
- `.specify/extensions.yml` 不存在，无 after_implement hooks。

FR-001/SC-001：六包新归属、原名称、无活跃旧包由 inventory 和 workspace 检查确认。FR-002–FR-006/SC-002：三个真实能力包、Host 命令面板和 Shell 收窄入口已接通；src/lib 有实际消费者，结构/依赖/循环/公开入口检查通过。FR-003/FR-007：上述双语、CSS、Provider、事件与持久化等价证据覆盖行为合同，未进行 UI 实测。FR-008：应用、资源、锁文件、守卫和活跃文档同步。FR-009/SC-005：仅 Spec 002 更新本轮独立证据。FR-010/SC-003–SC-004：63 个既有测试保留，202 项精选非 UI 检查及最终 lint/typecheck/build 通过，UI 为 excluded-by-user。FR-011：实际子 Agent 仅 Luna 与 Sol，按完整能力派发，主 Agent 集成共享文件。

T001–T024 全部完成；没有待补实现任务。用户约束内的验收完成，不将静态等价或构建成功表述为 UI 已实测。
