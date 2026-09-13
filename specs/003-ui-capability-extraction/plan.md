# Implementation Plan: UI 基础包继续提取能力（Spec 003）

**Branch**: `codex/package-refactor` | **Date**: 2026-09-12 | **Spec**: [spec.md](spec.md)

## Summary

从 `packages/client/ui` 提取三项跨能力实现：`ui-selectors`、`ui-resize`、`ui-disclosure`。同时将 ModelSelector 视图/模型辅助并入 `ui-agent-controls`，ColorPicker 并入 `ui-settings`，Sidebar primitives/行组件/pointer reorder 并入 `ui-sidebar`。基础 ui 保留按钮、输入、低层弹层、Portal、tokens、通用工具等。

以实际 `8d4b6568` 为输入：当前 72 个库包；ui 有 100 个受控文件、20 个测试文件，逐文件映射中 35 个整文件移动，另提取两个实际辅助和一个词典子树。目标预计 75 个库包，仅作清单核对。本计划已按后续实施指令执行，实际达到 75 个库包；验收见 validation.md。Spec 001/002 保持完成时记录，命名统一和 i18n 去重作为当前基线。

## Technical Context

- Language/Version：TypeScript ^7.0.2、React ^19.2.8；沿用锁文件。
- Primary Dependencies：pnpm 11.22.0，Base UI ^1.7.0、现有 i18n/UI/Extension Host/能力包。react-colorful ^5.8.1 随 ColorPicker 调整声明；不升级框架。
- Storage：无新存储。现有侧栏展开、布局比例、颜色设置、选择状态与安装实例保持。
- Testing：Node TypeScript loader、lint/typecheck、包结构/依赖检查及构建。UI/DOM/交互/Browser/Electron 手工和自动冒烟 excluded-by-user。
- Target Platform：Web、Desktop renderer/Electron；Runtime 只做构建/共享依赖兼容验证。
- Project Type：内部 workspace UI 能力库的归属重构。
- Performance Goals：不新增 Context、订阅、计时器或同步布局读取；保留 refs/memo/受控状态与回调时机。不承诺未测量的包体积变化。
- Constraints：领域/能力两级、目录叶名等于包名、TS/TSX、src/lib 各至多一级子目录、真实 helper、公开 exports、workspace:*、生产无环。
- Scale/Scope：三个新包、三个已有 owner 扩充、基础 ui 收窄；不拆所有基础控件，不机械移动其他领域。

## Constitution Check

| Gate                   | 研究前                   | 设计后                                                                                         |
| ---------------------- | ------------------------ | ---------------------------------------------------------------------------------------------- |
| I 独立能力与双语文档   | PASS：按消费者审计       | PASS：三项新能力有完整 src/lib/既有测试，三项复用已有 owner                                    |
| II 浅层 TS/真实 helper | PASS                     | PASS：resize/disclosure 现成 helper；selectors 提取现有尺寸/过渡计算；不建仅转发的 keyboard 包 |
| III 基础复用与无环     | PASS：需处理 ui 内部引用 | PASS：resize handle 同迁；ui 不回引新 owner；Portal/keyboard 保留基础层                        |
| IV 渐进迁移            | PASS                     | PASS：每批同步 exports/消费者/词典/CSS/测试，稳定行为不变                                      |
| V 验证后完成           | PASS：只规划             | PASS：实施验收在 quickstart，UI 排除按用户约束保留                                             |

无 constitution 例外。用户持续约束覆盖 UI 测试与交互冒烟，其他验证义务保留。实施已完成；只采用 validation.md 中本轮独立检查证据。

## Project Structure

```text
specs/003-ui-capability-extraction/
├── spec.md
├── plan.md
├── research.md
├── package-map.md
├── migration-inventory.json
├── data-model.md
├── contracts/ui-capabilities.md
└── quickstart.md

packages/client/                  # 已实施结构
├── ui/                          # primitives、Portal、tokens、基础 helpers
├── ui-selectors/                 # 新：富下拉、搜索、工作区选择
├── ui-resize/                    # 新：resize hooks/handle/算法/CSS
├── ui-disclosure/                # 新：展开滚动补偿/方向/scroll lock
├── ui-agent-controls/            # 已有：接收模型选择视图和模型 helper
├── ui-settings/                  # 已有：接收颜色选择及局部 CSS/词典
└── ui-sidebar/                   # 已有：接收通用 Sidebar 与拖放/行样式
```

每个新包含真实 src/lib、tests、manifest、tsconfig 与双语 README。三个新包目前没有自有产品文案：selector labels 来自 props、resize ariaLabel 来自 props、disclosure 无文案；不创建空 i18n 目录或空 bundle。发生真实文案所有权变化时才使用 `src/i18n/{index,en-US,zh-CN}.ts` 和共享 `useI18n(bundle)`。

## Implementation Phases

### P0 — 冻结接口与可执行清单

复核 [migration-inventory.json](migration-inventory.json) 全部 100 个来源及当前消费者；补执行时的精确导入符号/文件清单。检查原工作树、所有最近 AGENTS、测试入口与脚本前后置。单独登记 public barrel、共享 CSS、manifest/lock、混合 UI 测试与所有稳定参数。按 [contracts](contracts/ui-capabilities.md) 冻结 props 与生命周期。

### P1 — 提取三个基础能力

- `ui-selectors`：SearchableSelector、SelectorDropdown、WorkspaceSelector 和现有 dropdown 尺寸/过渡 helper 同迁。`ModelSelector` 同波由后续 P2 接入，直到其使用新入口之前，本批不算完成。保留 `selectorValidationErrorStyles` 等共享 menu 样式在 ui 的现有公开出口。
- `ui-resize`：hooks、spring/observer/比例 helper、CSS **与 CollapsibleResizeHandle 一起迁移**。如果只搬 hooks 而留下 handle，会迫使 ui 依赖新包并在 handle 使用 ui/utils 时形成回环，禁止该中间终态。
- `ui-disclosure`：方向 Context、Details、锁定 Hook、unlock event/查询与策略 helper 成组迁移，保持 conversation viewport 的同一锁状态来源。

每个能力交付包含新 manifest/公开入口/源码/辅助/既有测试路径/双语 README。主 Agent 接通消费者和删除旧出口后才记录该能力完成，不留 ui → 新包的生产兼容转发。

### P2 — 并入已有 owner

- 模型视图 → ui-agent-controls；使用 `src/model-selector-view.tsx` 避免覆盖已有 `src/model-selector.tsx` 业务连接器。helper 同迁，外部 types/filter 从新公开 `./models` 引入，业务连接器调用本地视图。依赖 ui-selectors。
- ColorPicker → ui-settings；`normalizeHexColor` 移入被组件实际消费的 lib，`react-colorful` 生产依赖随 owner 移动。`ui.colorPicker.*` 双语键原样移入已安装 settings bundle；从 ui bundle 删除该子树，禁止双注册或重新命名语义键。
- 通用 Sidebar/SidebarItems/pointer reorder → ui-sidebar。提供 `./primitives` 与 `./reorder` 窄入口，避免只需 Context 的消费者加载线程列表装配。ui-layout、ui-settings、automation、toolbox 等同步引用；ui-sidebar 内部用本地模块，不自引 package root。快捷键算法仍取 `@workbench/ui/keyboard`，不放入依赖 Extension Host 的业务 owner。

### P3 — 共享集成与样式顺序

主 Agent 统一写 ui 的 root/components/hooks barrels、manifests、lockfile、Shell CSS、ui-layout CSS 与词典聚合。完整样式顺序见合同：sidebar styles → ui components（control-icons）→ color-picker CSS，占用原 ui/components.css 三个 import 的位置；tokens 仍保持最后。ui-layout 原比例 CSS import 替换为 ui-resize/styles.css。

UI public `/resize`、`/disclosure`、`/proportional-panel.css` 与迁出组件/root/hooks export 删除；`/keyboard`、`/clipboard`、其余 hooks 与基础出口保持。混合的 shared-foundations UI 文件仍在 ui/tests，selector import 改新 owner，ui 只加测试用 devDependency，不形成生产回引。

### P4 — 验证、依赖清理与收口

逐项复核消费者、公有 props/types、词典键、CSS/Portal、Observer/RAF/listener 清理及 tests 映射；执行 quickstart 允许范围。按实际 import 清理依赖，不因移动猜测移除 Base UI/cmdk/lucide。通过后更新本 Spec 的实施证据；必要时同步根 AGENTS、skills 和当前 docs 中基础控件 owner。保留历史 Spec。

## Dependency and Dispatch

```text
P0 → [selectors | resize | disclosure]
selectors → model view integration
P0 → color integration
P0 → sidebar primitives integration
上述交付 → P3 shared integration → P4 validation

apps / product / Shell / existing capability owners
  → ui-selectors / ui-resize / ui-disclosure / existing ui-* owners
  → ui foundation / shared i18n
```

Sidebar 与 Settings 在同一批有 consumer 关系，按集成次序串行；不要让两个 Agent 同时写 ui-settings。每项必须完成真实消费者接入才验收。各能力内部源码/helpers/词典/CSS/tests/README 同一 owner。

| 模型         | 能力任务                                                                      | 写入边界                                                          |
| ------------ | ----------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| GPT-5.6 Luna | 接口冻结后的 selectors；随后 model/color 迁移                                 | 该能力来源/目标、局部测试和 README；不写共享 ui barrel/lock/Shell |
| GPT-5.6 Sol  | resize/disclosure 的观察与锁生命周期；sidebar Provider/reorder 迁移和无环审查 | 每次只拥有一组能力及其消费者建议；共享文件交主 Agent              |
| 主 Agent     | 依赖排序、能力交接、共享入口/CSS/manifests/锁文件/Spec、最终检查              | 明确互斥写入，按可用槽位派发                                      |

仅使用 Luna/Sol 子 Agent，默认最多两位实施者并行，更多槽位不是拆散同一能力的理由。用户后续已授权实施，能力交付与共享集成均已完成。

## Validation Strategy

见 [quickstart.md](quickstart.md)。所有 UI/混合测试只迁移不运行。尤其 `use-collapsible-resize.test.ts` 含 React render，`observe-resize-handle.test.ts` 使用 fake DOM/ARIA/ResizeObserver，均不可误归纯逻辑。允许 spring 数值/比例、disclosure policy、模型筛选与颜色正规化等明确非 UI 入口。词典/样式静态等价和类型通过不能表述为交互已实测。

## Tooling Notes

setup-plan.sh 已运行并指向本 Spec。脚本的 BRANCH 为逻辑 feature ID；真实 Git 分支保持 `codex/package-refactor`。仓库没有 update-agent-context.sh，以根 AGENTS 的简短计划指引替代；没有 extensions.yml，before/after plan hooks 跳过。

speckit-tasks 已生成 tasks.md，speckit-implement 已执行全部任务；本轮没有提交或推送。

## Planning Verification（规划时记录）

本轮仅做文档和只读源码核对：inventory 的100个来源均存在，35个目标没有覆盖现有文件的冲突；在当前72包生产依赖图上加入计划中的三个新包和消费者依赖，得到75包的无环预期图。这是规划可行性检查，实施后仍须运行实际守卫。

文档格式与 git diff --check 通过；当前改动仅本 Spec、feature.json 和根 AGENTS 的计划上下文。没有实施源码迁移或执行 UI/产品测试。研究中提出的 ui-keyboard 独立包及将 fake DOM resize 用例视为非 UI 的建议经主 Agent 复核后未采纳，最终取舍以上述研究/验证合同为准。

## Implementation Result

全部 17 项任务完成。三个新能力包与三个已有 owner 已接通所有消费者；35 个整文件移动、两个真实 helper 提取和七个双语键迁移完整。源码/测试清单、生产依赖与结构检查、15 项纯逻辑用例、13 项扩展源码边界检查、lint、全仓 typecheck 及 Runtime/Web/Desktop/Electron 构建通过。

CSS/Context/Portal/生命周期通过静态等价复核。全部 UI 测试 excluded-by-user，保留但未执行。Web 和 Desktop 构建各出现既有 Pi prompt highlight CSS 解析 warning，不影响退出成功。详细证据见 validation.md；源 manifest 保留为基线快照。
