# Research: Client 归属与组件拆分

## 第二阶段研究：Client 归属（2026-09-12，当前有效）

以下基于当前文件与 manifests，只读研究 agent 独立核对了 Shell 组件、嵌套 AGENTS 与依赖环；此前 34 包等数字为第一阶段初始历史。

### R-C1 目录语义与范围

- **Decision**：workbench 六包移动到已有 client，原 package name 保留；其他领域保留。
- **Rationale**：当前 workbench 仅有 shell/pi-product/host-client/services-client/host-contracts/desktop-contracts；用户明确要求 workbench 改成 client，两级包根仍符合 constitution。client 下的 contracts 继续环境中立，不因此引入 DOM/Node 依赖。
- **Alternatives considered**：改 @workbench namespace 会扩大 API 重命名；把所有 frontend 包搬进 client 会覆盖已确认的 workspace/conversation/pi 归属，均不采用。

### R-C2 从参考选择组件粒度

- **Decision**：新增 ui-sidebar、ui-panels、ui-layout，保留 shell 为应用装配。已存在的 ui、appearance、settings-ui、conversation、composer 等直接复用，不照抄参考中的每个 ui-*。
- **Rationale**：sidebar 的线程/工作区行为、panels 的停靠/缩放、layout 的跨区域框架是三个完整组件能力；用户本次要求继续拆组件，参考明确包含 ui-sidebar/ui-layout。ui-panels 管理完整停靠能力而非为八个文件各建一个包。ui-layout 保持一个整体，不继续拆 Header/Statusbar/resize。
- **Alternatives considered**：只拆 sidebar、把所有 frame/panels 留 Shell 的方案更小，也是只读研究建议；本计划选择把框架组件与 application 安装区分，以落实本次“组件拆出来”的范围，但不拆单个视觉控件包。没有新能力的 goal/permission/workflow 等不创建。

### R-C3 词典与循环

- **Decision**：能力 bundle 在所属包提供；Shell 仅聚合。workspace-sidebar 扩展同 sidebar 迁移，品牌扩展归 layout。
- **Rationale**：当前 sidebar/panels/header/command palette 均可能通过 ../i18n 回指 Shell，直接移动会形成环。sidebar lib/thread-sort.ts 还依赖 src/sidebar/sidebar-reorder.ts，必须同能力移动，不能留在 Shell。
- **Alternatives considered**：共享巨型产品字典、临时第二套 Hook 或继续 shell/i18n 回指均不采用。当前 Shell locale hydration/cookie/revision 适配保留。

### R-C4 命令、线程菜单与终端

- **Decision**：命令面板归 extension-host 显式入口；线程菜单归 ui-sidebar，Header 使用公开组件；TerminalDrawer 归 ui-panels。
- **Rationale**：命令面板已消费 Host command service 和 platform 字典。线程菜单使用 workbench.sidebar 文案及 thread.menu Slot，与线程列表操作共同所有，不是消息 renderer。TerminalDrawer 仅返回 bottom PanelDock，没有终端实现，不能引入 terminal-ui → panels 反向依赖。
- **Alternatives considered**：独立 ui-commands 包无必要；线程菜单归 conversation 亦可，但会扩大已完成消息能力包范围，本轮选择与 sidebar 文案/操作共置。

### R-C5 构建、生命周期与工具

- **Decision**：沿用源码 exports 和 @workbench/shell/styles.css 聚合，迁移 @source 与检查器物理路径；不引入参考中的 tsdown/client.js/lib 产物结构。
- **Rationale**：当前 shell-layout.css 包含跨区域作用域，布局迁移须保留顺序与 Portal 属性；application.tsx 持有安装实例，继续保持其生命周期可避免重复服务。参考文本只有目录，不能据此推导其接口或复制实现。
- **Alternatives considered**：全量更换库构建流水线与 SDK 升级均与本次目标无关。

**未知项结论**：目录范围、包名、能力归属、i18n、CSS、公开接口兼容及验证策略均已确定，无待澄清设计项。具体逐文件清单由任务阶段从当前代码冻结，不能用旧测试数量作新验收。setup-plan 的逻辑 BRANCH 与 Git 分支差异已解释；仓内无 update-agent-context.sh，采用明确记录的手动上下文更新。

## 用户补充约束：验证与 Agent（当前有效）

- **Decision**：Spec 002 不新增或执行 UI 测试，改用 UI 静态审查；非 UI 逻辑验证与构建保留。多 Agent 按完整能力派发，使用 gpt-5.6-luna 与 gpt-5.6-sol，按 plan 的复杂度分工。
- **Rationale**：用户明确要求，覆盖先前本轮计划中的组件测试与 Web/Desktop UI 冒烟要求；不改变功能兼容目标，不删除既有测试。
- **Alternatives considered**：不执行混合全量测试命令来绕过排除范围，不为此次重构永久关闭仓库 UI 测试；不使用未指定模型作为重构子 Agent。
