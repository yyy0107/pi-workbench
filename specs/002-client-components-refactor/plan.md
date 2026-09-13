# Implementation Plan: Client 归属与 Shell 组件拆分（Spec 002）

**Branch**: `codex/package-refactor` | **Date**: 2026-09-12 | **Spec**: [spec.md](spec.md)

## Summary

在第一阶段实际完成的 69 个库包基础上，将 `packages/workbench` 的六个包合并归入已有 `packages/client`，继续提取 Shell 的侧栏、面板和布局能力。参考用户提供目录中的 `ui-sidebar`、`ui-layout` 等按能力组织方式，不照搬不存在的业务功能、JS 产物或构建配置。保留两级领域包根、TS/TSX、真实能力 src 与内部辅助 lib。

本文件记录本轮设计；源码迁移已实施，当前证据见 [validation.md](validation.md)。前置重构见 [Spec 001](../001-workbench-package-refactor/spec.md) 及其 [验收记录](../001-workbench-package-refactor/validation.md)。本轮为独立 Spec 002，历史结果不能作为本轮验收。已生成独立 [tasks.md](tasks.md)，共 T001–T024；实施进度按该清单独立记录。

## Technical Context

- **Language/Version**: TypeScript ^7.0.2，React ^19.2.8；延用当前锁文件解析版本。
- **Primary Dependencies**: pnpm 11.22.0、现有 Next.js/Electron 应用、Extension SDK/Host、i18n、UI、shell-context、workspace-runtime、agent-runtime-client；不新增框架或升级 SDK。
- **Storage**: 现有设置、会话草稿、滚动位置与工作区布局；无数据迁移，稳定键不变。
- **Testing**: 现有 Node TypeScript 测试加载器、包 typecheck、oxlint/oxfmt、结构和依赖检查、应用构建及相关非 UI 逻辑测试；不新增或运行 UI 测试。
- **Target Platform**: Web、Desktop renderer/Electron；Runtime 仅验证共享契约与路径消费者兼容。
- **Project Type**: 多宿主应用与内部 workspace 能力库。
- **Performance Goals**: 不新增安装实例、订阅、事件流或重复组件挂载；保留 resize、拖放、流式展示行为；比较同环境构建产物，不承诺未经测量的体积改善。
- **Constraints**: 两级包根，src/lib 各最多一级子目录，显式 exports/workspace:*，生产依赖无环；沿用统一 i18n、区域 token 与 Portal。
- **Scale/Scope**: 六个包目录移动，三个新能力包，现有 Extension Host 接收命令面板。其他已拆出的 client/conversation/workspace/pi 能力沿用现有所有者。包数预计 72，仅作清单核对，不作为成功指标。

## Constitution Check

| Gate                                          | 研究前                         | 设计后                                                             |
| --------------------------------------------- | ------------------------------ | ------------------------------------------------------------------ |
| I 领域/能力两级、独立职责                     | PASS：client 为已有领域        | PASS：六包保名移动，三个独立 UI 能力                               |
| II TS/TSX、src/lib 实质分工、浅目录、公开接口 | PASS：不改变既有约定           | PASS：迁移表要求真实辅助消费者，不制造空包或转导出壳               |
| III 基础复用与单向依赖                        | PASS：识别 Shell i18n 反向引用 | PASS：能力 bundle 下放，共享契约留 shell-context；布局不依赖 Shell |
| IV 渐进迁移兼容                               | PASS：历史结果保留             | PASS：每批同步消费者、双语、样式、测试、文档，稳定 ID/顺序不变     |
| V 验证后完成                                  | PASS：只规划                   | PASS：本阶段未标完成，验证入口在 quickstart                        |

用户本轮明确覆盖 constitution V 中涉及 UI 测试与跨宿主交互冒烟的要求：UI 仅静态审查，不执行测试；其他验证原则保留。此范围限定仅适用于 Spec 002，不改写 Spec 001 或全局 constitution。当前旧目录是待迁移输入，不添加新的通配基线。client 是目录分类，并不意味着其契约只能被浏览器引用；host/desktop contracts 仍必须是环境中立契约。

## Project Structure

```text
packages/client/
├── shell/               # 应用 Providers、运行安装桥接、默认扩展装配、样式聚合
├── pi-product/          # 现有 Pi 产品装配，包名不变
├── host-client/         # 现有宿主接入
├── services-client/     # 现有客户端服务适配
├── host-contracts/      # 环境中立契约
├── desktop-contracts/   # 环境中立桌面契约
├── ui-sidebar/          # 工作区/会话列表、排序、侧栏扩展
├── ui-panels/           # PanelDock、PanelLayout、容器、标签、缩放
├── ui-layout/           # 主框架、侧栏外框、Header/Statusbar、全局层与布局生命周期
└── ...                  # 原有 ui/i18n/appearance/settings 等能力保留
packages/extension-platform/host/  # 接收 CommandPaletteHost
```

每个新增包采用 `{src,lib,tests,package.json,tsconfig.json,README.md,README.zh-CN.md}`；组件与装配归 src，实际消费的排序/尺寸/事件辅助归 lib，词典归 src/i18n/<locale>.ts。源码与辅助不再嵌套第二级目录。现有单一构建流水线不变。

设计入口：[研究](research.md)、[包映射](package-map.md)、[对象模型](data-model.md)、[新合同](contracts/client-components.md)、[验证](quickstart.md)。历史机器清单仍描述第一阶段真实代码，实施迁移后才更新，不将目标结构伪装成当前事实。

## Implementation Phases

### C0：建立本阶段清单

从当前代码重新记录六包 exports、依赖、源/测试/资源、扩展顺序及双语键归属，标记历史验证为第一阶段。通过现有语法解析检查器核对引用，不以文本中出现旧路径一概判错。脚本、Tailwind、测试夹具、文档与历史快照分开处理。

### C1：六包归入 client

按 package-map 移动六个目录，保持 package name、exports、内容和依赖层次。更新 pnpm-workspace.yaml（移除 workbench glob）、锁文件 importer、应用 CSS @source、检查器路径、基准脚本与当前文档/技能。client 已有 glob，不覆盖已有目录。重新 pnpm install --lockfile-only 并 pnpm install --frozen-lockfile，核验 workspace 链接。保持源码 exports，读取本地 Next.js 相应指南后才修改任何 Next 配置。

阶段门槛：六包与直接消费者类型/相关非 UI 测试、结构/依赖检查及对应应用构建通过，packages/workbench 不再持有活跃包。

### C2：切断共享依赖

分配 sidebar/layout/panels 文案给能力 bundles；共用 sidebar 文案由 sidebar 导出已存在的 bundle factory 语义接口。所有能力直接使用 @workbench/i18n API，不导入 Shell 的 Provider/messages/runtime。Shell 的 locale hydration/revision/cookie 适配继续服务唯一安装 Context，聚合 bundles，不产生第二套状态。

CommandPaletteHost 归 Extension Host 的显式 command-palette 入口，保留已有目录服务导出，加入该组件而不建立重复实现；直接使用平台现有双语 bundle。提取实际使用的键盘目标辅助到所属 lib。只有 app/layout 挂载命令面板，保持快捷键及 ownerRootRef/Portal 所有权。

### C3：拆 sidebar 与 panels

迁移 ui-sidebar 的会话列表、工作区上下文、排序/拖放、workspace-sidebar 扩展、对应测试及词典。ConversationActionsMenu 属于线程列表操作，归 sidebar 并供 Header 使用。框架/sidebar resize 的尺寸状态保留 ui-layout。

迁移 ui-panels 的通用 Panel 布局组件、对应尺寸辅助、词典及测试。Panel store 继续由 shell-context 提供，实例继续由应用安装创建。TerminalDrawer 仅是 bottom PanelDock 包装，保留于 panels，不让 terminal-ui 反向依赖面板宿主；不改变终端后台生命周期。

阶段门槛：两能力包不导入 Shell/ui-layout/pi-product，相关非 UI 逻辑测试与消费者静态检查通过。

### C4：提取 ui-layout，收窄 Shell

迁移主框架、Header、Statusbar、全局覆盖层、侧栏外框与 resize、布局/窗口观测、侧栏设置 hydration；相关私有辅助与区域 CSS 同迁。ui-layout 通过 sidebar/panels、公共 Context 和现有运行时公开接口装配，保持 WorkbenchShellProps 所有语义。

Shell 保留 application.tsx 的应用安装、设置/i18n 适配、工作区桥接、持久化适配和默认扩展安装目录。workbench-brand 为框架展示扩展，随 ui-layout 输出，Shell 仅安装。Shell 样式入口按原顺序聚合各能力 CSS，布局包自身不导入 Shell CSS。应用级 /application 与 /styles.css 保持；仓内布局调用改用 @workbench/ui-layout，删除迁出组件的 Shell 旧公开转发入口，类型通过其真正所有者引用。

阶段门槛：Shell 不再持有 sidebar/panels/frame 组件实现；没有跨包源码引用、反向 i18n 依赖或循环；安装 ID、运行时实例和 Provider 生命周期不变。

### C5：收口

按真实模块使用清理六包尤其 Shell 遗留的直接第三方依赖，不凭目录移动猜测删除。更新 inventories、helper consumers、README、最近 AGENTS、技能路径和架构守卫；历史快照保留并标明范围。完成 quickstart 的本阶段验收，记录新证据，之后才标记任务完成。

## Interface Decisions

完整合同见 [contracts/client-components.md](contracts/client-components.md)。依赖方向为 app/pi-product → shell → ui-layout/ui-sidebar/ui-panels → 公共 runtime/context/ui/i18n/contracts；ui-layout 可依赖 sidebar/panels，后二者不得反向依赖布局。Extension Host 不导入新的功能包或 Shell。

样式区域和 Portal 标记保持现有 DOM 语义；安装注册始终在原装配生命周期执行，组件 render 不 register。保留 stable IDs、顺序、快捷键和持久化格式。未迁移的 conversation、workspace 与 Pi 功能保持原领域所有者。

## Validation Strategy

规划时只检查文档。实施时不新增、不运行 UI 测试（组件渲染/交互、DOM 快照、视觉回归、Browser/Electron UI 自动化或手工交互冒烟）；既有 UI 测试随 owner 保留迁移，可调整路径。UI 的兼容性通过代码、类型、词典键/插值及样式 token/Portal 归属静态检查确认。

运行 lint、typecheck、结构/依赖检查、相关非 UI 逻辑测试及构建。不直接运行会包含 UI 测试的 pnpm check、包级全量 test 或 Electron pack/混合 smoke；先查看脚本，再拆成不含 UI 的命令或精确筛选非 UI 用例。没有可独立运行的非 UI 入口时记录限制，不通过更名或绕行执行 UI 测试。UI 测试记为“按用户约束不执行”，不作为阻塞或通过证据。

## Multi-Agent Dispatch

多 Agent 重构按能力派发，子 Agent 限用 `gpt-5.6-luna` 与 `gpt-5.6-sol`，不按任意文件数量拆散同一能力。

| 模型         | 默认负责范围                                                                                       |
| ------------ | -------------------------------------------------------------------------------------------------- |
| gpt-5.6-luna | 接口已确定的独立能力迁移，如 ui-sidebar、ui-panels 的源码/辅助/词典/样式和既有测试路径整理、README |
| gpt-5.6-sol  | 跨包契约与循环解耦、Extension Host 命令面板归属、ui-layout/Shell 生命周期与集成适配                |

主 Agent 在派发前明确能力 owner、文件写入范围、公开接口、前置依赖与允许的非 UI 验证。先完成六包目录迁移和共享接口约定，再并行处理互不重叠的 sidebar/panels 等能力；layout 等待其依赖稳定后接入。pnpm-workspace.yaml、锁文件、应用聚合入口、共享合同和 Spec 进度由主 Agent 统一协调写入，避免并发覆盖。

每个子 Agent 汇报改动、接口、静态检查/非 UI 测试结果与未决问题；主 Agent 汇总并验证跨能力依赖。子 Agent 派发须显式指定模型；能力复杂度升级时由 luna 移交 sol，先交接所有权再继续，不让两者同时修改同一能力。任务生成时给出能力、模型、前置和验证范围；实施阶段按上述规则派发重构 Agent。

## Tooling Notes

setup-plan.sh 通过 feature.json 定位本 Spec，返回 BRANCH=002-client-components-refactor 是逻辑 feature 标识；真实 Git 分支仍为 codex/package-refactor。不因此切换或创建分支。

本仓未提供 update-agent-context.sh；已检查当前脚本清单和 Git 跟踪文件。以 AGENTS.md 的简短当前规划指引补充上下文，不改写组件规则。此项为手动替代，不能声称已运行不存在的更新器。未配置 extensions.yml，前后 plan hooks 均跳过。
