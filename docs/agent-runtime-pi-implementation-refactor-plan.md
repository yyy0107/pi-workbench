# Workbench Agent Runtime 边界与 Pi Implementation 重构计划

状态：阶段 1–7 已完成（2026-09-04）；阶段 8 待继续。

本计划是已完成的
[`assistant-ui-removal-and-custom-runtime-plan.md`](./assistant-ui-removal-and-custom-runtime-plan.md)
的后续架构计划。前一份计划的“已完成”结论保持不变。

## 1. 决策摘要

本次重构重新建立所有权边界，不创建第二套 Runtime 或 RPC 框架：

```text
Workbench Contracts / Ports
            ↓
Pi Runtime Implementation
            ↓
Pi SDK / Pi RPC / Pi Session Events

Workbench Shell UI
            ↓
Workbench Runtime Capabilities
            ↑
Pi Runtime Implementation
```

完成后应满足：

- `Adapter` 是 Workbench 定义的架构概念；Pi 是 Agent Runtime 的一个具体实现。
- Pi 实现位于 `packages/agent-runtime/runtimes/pi`，不保留原 Pi Adapter 子树的兼容层。
- 通用前端只依赖 Workbench 类型、Conversation 投影和能力接口，不依赖 Pi Protocol、Pi Client
  facade 或 `PiApiError`。
- Pi 原始事件只存在于 Pi 实现内部；Shell 使用 `ConversationNode`、`MessageBlock`、运行状态和能力
  presence 渲染。
- 不新增通用原始 `AgentEvent`、动态 Runtime registry、新 workspace package 或第二套 RPC。
- `@workbench/agent-runtime-pi-*` package 名称、RPC wire shape、持久化格式、扩展 ID、设置键和激活顺序
  保持兼容。
- Web、Desktop 和 Runtime Node 继续作为具体 Runtime 的组合入口。

## 2. 当前基线

统计日期：2026-09-04。统计只计算生产 `.ts`/`.tsx` 文件，不包含测试。

| 范围                                                                | 当前值 |
| ------------------------------------------------------------------- | -----: |
| Agent Runtime Core Contracts / Runtime / Client 直接导入 Pi package |      0 |
| Workbench Shell 直接导入 Pi package                                 |      0 |
| Extension SDK / Host 直接导入 Pi package                            |      0 |
| Pi Contributions 生产文件                                           |    191 |
| Pi Contributions 直接导入 Pi Client 的生产文件                      |     44 |
| Pi Contributions 直接导入 Pi Protocol 的生产文件                    |     48 |
| Pi Contributions 直接导入 Pi Client 或 Protocol 的生产文件（去重）  |     71 |
| 同时导入 Pi Client 与 Protocol 的生产文件                           |     21 |
| Web 扩展激活序列                                                    |  31 项 |
| Desktop 扩展激活序列                                                |  32 项 |

阶段 1 审计还发现 `@workbench/host-artifact-policy` 曾直接导入 Pi `STREAM_PATHS`。该依赖已在阶段 1
移除：通用 artifact policy 现在接收应用组合层传入的 Agent Runtime Upgrade 路径，Pi 路径分别由
Web、Desktop Electron 和 Runtime Node 组合入口提供。

阶段 1 基线时，Pi 物理路径仍位于原 Pi Adapter 子树，这是阶段 2 前的唯一过渡例外。阶段 2 已将其
原子移动到 `packages/agent-runtime/runtimes/pi`，并同步切换边界测试中的唯一实现根。

## 3. 所有权与能力划分

| 功能                                                                 | 最终所有者                 | 迁移方式                                                    |
| -------------------------------------------------------------------- | -------------------------- | ----------------------------------------------------------- |
| Conversation timeline、message blocks、running/loading/composer 状态 | Workbench Agent Runtime    | 继续使用 Core Contracts 与 Runtime                          |
| Workspace explorer、workspace review                                 | Workbench Shell            | 直接迁移，删除 Pi 命名安装服务                              |
| Workspace directory、project trust、local app、file、Git             | Workbench                  | 定义当前 UI 所需的最小能力，Pi 保持现有实现                 |
| Terminal                                                             | Workbench Terminal + Shell | 复用 terminal contracts/client 和 Shell `RuntimeConnection` |
| Automation                                                           | Workbench Automation       | 复用 `AutomationProtocol`，Pi 提供实现                      |
| Model Selector                                                       | Workbench                  | 使用通用 `ModelSelection` 与 model capability               |
| Interactive Requests                                                 | Workbench                  | 使用通用 interaction capability                             |
| Side Chat                                                            | Workbench                  | 使用通用 scratch-session capability                         |
| Attachment / Image Understanding                                     | Workbench                  | 复用 attachment-understanding contracts                     |
| Token Usage / Context Policy                                         | Workbench                  | 使用通用 context capability                                 |
| Agent Configuration                                                  | Pi                         | 保留在 Pi Contributions                                     |
| Provider / Model Configuration                                       | Pi                         | 保留在 Pi Contributions                                     |
| Pi Settings                                                          | Pi                         | 保留在 Pi Contributions                                     |
| Toolbox、Pi packages/skills/extensions/prompts                       | Pi                         | 保留在 Pi Contributions                                     |
| Context Trace                                                        | Pi                         | 保留在 Pi Contributions                                     |
| External Session Import                                              | Pi                         | 保留在 Pi Contributions                                     |
| Pi Version、Connection Status、Running Indicator、branding           | Pi                         | 保留在 Pi Contributions                                     |

Model Selector 只负责当前会话的通用模型选择；provider 认证、模型来源配置和 Pi 专属配置仍属于 Pi。
Context Policy 与 Token Usage 上提为 Workbench 能力；展示 Pi 内部事件的 Context Trace 不上提。

## 4. Workbench 公共接口目标

### 4.1 Runtime Environment 能力集合

在现有 `@workbench/agent-runtime-client` 中扩展 `WorkbenchAgentRuntimeEnvironment`，不创建新 package：

```ts
interface WorkbenchAgentRuntimeCapabilities {
  readonly host?: WorkbenchRuntimeHostCapability;
  readonly workspace?: WorkbenchWorkspaceCapability;
  readonly models?: WorkbenchModelSelectionCapability;
  readonly interactions?: WorkbenchInteractionCapability;
  readonly scratchSessions?: WorkbenchScratchSessionCapability;
  readonly context?: WorkbenchContextCapability;
  readonly automation?: AutomationProtocol;
  readonly attachmentUnderstanding?: WorkbenchAttachmentUnderstandingCapability;
}
```

约束：

- 每个 capability 只包含当前通用 UI 已实际使用的方法。
- host、directory、local-app、trust DTO 归入 host contracts。
- workspace、file、Git、model、interaction、scratch-session、context DTO 归入 agent-runtime contracts。
- automation、attachment、terminal 继续复用现有领域 contracts。
- 提供按能力拆分的 hooks；组件不得用 `runtime.id === "pi"` 判断功能。
- capability 缺失时不安装或不显示入口；恢复的历史 UI 状态可显示明确的 unsupported 状态，但不得注入
  no-op 或假实现。

### 4.2 通用错误边界

Workbench Client 增加 `WorkbenchAgentCapabilityError`，包含稳定 `code` 和可选 `details`。Pi 在实现
边界把 `PiApiError` 映射为该错误。迁移后的 Shell 不执行 `instanceof PiApiError`，也不暴露 Pi
HTTP/RPC transport 细节。

### 4.3 Server Adapter

保留 Workbench 定义的 `WorkbenchAgentServerAdapter`。它继续负责 agent commands、execution 和
threads，不扩展为 service locator。Workspace、host、terminal、automation 和 attachment 使用各自的
Workbench domain ports，由 Pi Server 在组合层实现或绑定。

### 4.4 事件边界

不新增 `WorkbenchAgentEvent`，也不复制 Pi 事件枚举：

```text
Pi session/raw events
  -> Pi Client projection
  -> ConversationNode / MessageBlock / snapshot / capabilities
  -> Workbench Shell
```

Shell 不理解 Pi event name。

## 5. 目录与命名规则

阶段 2 原子移动：

```text
原 Pi Adapter 子树
→ packages/agent-runtime/runtimes/pi
```

必须同步更新 `pnpm-workspace.yaml`、`pnpm-lock.yaml` importer、Web/Desktop CSS source glob、构建与打包
脚本、路径测试、README/docs、隐藏 `.agents/skills` 引用和应用组合入口。

Pi 实现内部的结构性命名调整：

| 当前名称                           | 目标名称                                  |
| ---------------------------------- | ----------------------------------------- |
| `createPiAgentServerAdapter`       | `createPiAgentServerImplementation`       |
| `PiAgentServerAdapterDependencies` | `PiAgentServerImplementationDependencies` |
| `createPiAgentExecutionAdapter`    | `createPiAgentExecution`                  |
| `createPiAgentThreadStoreAdapter`  | `createPiAgentThreadStore`                |
| `session-rpc-adapter.ts`           | `session-rpc-projection.ts`               |
| `ExternalSessionSourceAdapter`     | `ExternalSessionImporter`                 |
| Codex/Claude/Cursor source adapter | 对应 `*SessionImporter`                   |

以下名称不改：Workbench 的 `WorkbenchAgentServerAdapter`、attachment-understanding 的 OCR Adapter
概念，以及 wire/persistence 中的既有字面量（例如 `modelsSource: "adapter"`）。

## 6. 实施状态

- [x] 阶段 1：建立边界保护（2026-09-04）
- [x] 阶段 2：移动目录并纠正结构命名（2026-09-04）
- [x] 阶段 3：增加最小 Workbench Capability 层（2026-09-04）
- [x] 阶段 4：迁移已经与 Pi 无关的通用扩展（2026-09-04）
- [x] 阶段 5：迁移 Workspace / Host 垂直切片
- [x] 阶段 6：迁移会话级通用能力（2026-09-04）
- [x] 阶段 7：收缩 Pi Contributions（2026-09-04）
- [ ] 阶段 8：清理与文档收尾

### 6.1 阶段 1：建立边界保护

- [x] 全仓边界扫描覆盖 `.ts`、`.tsx`、`.js`、`.jsx`、`.mts`、`.cts`、`.mjs` 和 `.cjs` 的静态
      import、export、dynamic import 与 `require()`。
- [x] 扫描 workspace manifest，Pi package 依赖只允许位于 Pi 实现、应用或根级公开组合测试。
- [x] Core、Shell、Extension SDK/Host 禁止导入任何 `@workbench/agent-runtime-pi-*` package。
- [x] Pi Contributions 可导入 Client、Shared、Protocol，但禁止导入 Pi Server。
- [x] Pi package 的非实现消费者使用逐文件、逐 specifier 的应用组合白名单，不允许目录前缀放行。
- [x] Shell 额外禁止出现 `PiApiError` 标识符。
- [x] 移除 `@workbench/host-artifact-policy` 对 Pi Protocol 的直接依赖。
- [x] 固化 Web 与 Desktop 的扩展 ID、唯一性和激活顺序。
- [x] 记录当前依赖统计、阶段状态和验证结果。

边界保护的主要测试：

- `apps/web/test/workbench/runtime-contributions/installed-agent-runtime.test.ts`
- `packages/workbench/shell/test/dependency-boundaries.test.ts`
- `apps/desktop-renderer/test/static-export-boundary.test.ts`
- `packages/host/artifact-policy/test/runtime-admission.test.cjs`
- `apps/desktop-electron/test/runtime-artifact-admission.test.cjs`

Web 基线序列：

```text
workbench.brand
workbench.workspace-sidebar
workbench.appearance
workbench.locale-selector
workbench.message-presentation
workbench.message-actions
workbench.user-message-index
workbench.message-queue
workbench.archived-chats
workbench.workspace-explorer
workbench.workspace-review
workbench.workspace-browser
workbench.workspace-artifact
workbench.terminal
workbench.workspace-directory-picker
workbench.git-branch
workbench.settings
workbench.agent-configuration
workbench.interactive-requests
workbench.side-chat
workbench.setting-model-config
workbench.pi.settings-action
workbench.image-understanding
workbench.toolbox
workbench.automations
workbench.model-selector
workbench.connection-status
workbench.context-trace
workbench.external-session-import
workbench.token-usage
workbench.workspace-file
```

Desktop 使用同一序列，并在末尾追加 `workbench.desktop-runtime-lifecycle`。

验证记录：

- 95 项定向测试通过：Runtime artifact builder 49 项、Host artifact policy 31 项，以及其他边界、
  扩展快照和 Runtime Host 测试 15 项。
- `pnpm check:workspace-dependencies` 通过。
- `@workbench/runtime-node`、`@workbench/web`、`@workbench/desktop-renderer`、
  `@workbench/desktop-electron` 与 `@workbench/shell` 定向 typecheck 通过。
- 本阶段未创建提交；提交哈希在实际提交后补记。
- 按验证策略未运行 Browser/E2E 或全量构建：阶段 1 没有 UI 交互、渲染或 Runtime 行为变化。

### 6.2 阶段 2：移动目录并纠正结构命名

- [x] 原子移动整个 Pi Runtime 到 `packages/agent-runtime/runtimes/pi`。
- [x] 更新 workspace、锁文件、构建、CSS、测试、文档和 skill 路径。
- [x] 完成 Pi 实现内部结构性 `Adapter` 重命名。
- [x] 保持 package 名称与不表达错误架构含义的公开 export 稳定。
- [x] 阶段 2 保持为独立机械变更，未混入 capability 迁移。

验证记录：

- `pnpm install --frozen-lockfile` 通过 lockfile 与供应链策略校验，并刷新 33 个 workspace projects。
- Pi 的 5 个 packages，以及 Runtime Node、Web、Desktop Renderer、Desktop Electron 的定向 typecheck
  通过。
- 85 项目录、依赖边界、Runtime 组合、RPC projection、Agent 端口和外部会话导入定向测试通过。
- `pnpm check:workspace-dependencies` 与 `pnpm lint` 通过；3 个被更新的本地 skill 均通过
  `quick_validate.py`。
- `@workbench/runtime-node` artifact 构建通过；输出仍正确 externalize Pi coding-agent、PTY、parser 与
  WebSocket 依赖。
- `rg --hidden` 确认原目录字面引用为零；结构命名测试确认 Pi Runtime 仅保留明确允许的 OCR Adapter
  文件与 Workbench-owned `WorkbenchAgentServerAdapter` contract。
- 按验证策略未运行 Browser/E2E、全量 `pnpm check` 或完整 Web/Desktop 构建：本阶段没有 UI 行为或
  Runtime wire/state 变化，相关最终验证留在阶段 8。

### 6.3 阶段 3：最小 Workbench Capability 层

- [x] 扩展 Runtime Environment 与 provider props。
- [x] 定义通用 DTO、窄能力接口、hooks 和 capability error。
- [x] `PiAgentRuntimeProvider` 使用现有 facade/RPC 组装 capabilities。
- [x] Pi facade 暂时作为实现内部桥接；消费者迁完后才删除无用 export。
- [x] 每个 capability 增加一个最小 contract/projection 测试，不建立 registry。

验证记录：

- Attachment Understanding、Host、Agent Runtime Contracts/Client、Pi Protocol/Client 共 6 个受影响
  package 的定向 typecheck 通过。
- Agent Runtime Client 24 项与 Pi Client 276 项测试通过；新增投影测试覆盖 8 个 capability、缺失能力
  和 Pi error 到 Workbench error 的映射。
- `pnpm check:workspace-dependencies`、Shell/Core dependency boundary tests 与 `pnpm lint` 通过。
- `pnpm build` 通过 Runtime Node、Web、Desktop Renderer 与 Desktop Electron artifact 组合。
- 本阶段改动作为独立提交提交；按验证策略未运行 Browser/E2E，因为没有 UI 交互或渲染变化。

### 6.4 阶段 4：迁移无 Pi 语义的通用扩展

- [x] 迁移 Workspace Explorer。
- [x] 迁移 Workspace Review。
- [x] 迁移 Terminal，并改用 Shell `useRuntimeConnection`。
- [x] 删除 Pi 命名的 workspace target、Git review 与重复 Runtime Connection 安装服务。
- [x] 通用 assets/provider 与 `en-US`、`zh-CN` 文案随组件迁入 Shell。

实现记录：

- Explorer、Review、Terminal 迁入 `packages/workbench/shell/src/extensions/builtin`，由 Shell workspace
  group 按原顺序安装；Web 与 Desktop 的完整 extension ID 序列保持不变。
- 文件运行时 contract、diff service 与当前 workspace target service 迁入 Shell 的
  `workspace-files` 公开子路径；Pi Contributions 暂时只保留阶段 5 尚未迁移的文件 backend。
- Git review 与 workspace target 复用 RightWorkspace 的安装级资源所有权；删除 Pi 的重复安装服务。
- Terminal、Workspace Directory Picker 与 Workspace File 改用 Shell `useRuntimeConnection`，删除 Pi
  Runtime Connection context。
- File Viewer asset base 与 branding 统一读取 Workbench presentation provider；删除 Pi 的重复
  assets/branding context。Explorer、Review、Terminal 的两套基础语言文案随组件迁入 Shell。

验证记录：

- Shell、Pi Contributions、Web、Desktop Renderer 定向 typecheck 全部通过。
- Shell 384 项、Pi Contributions 193 项、Web 131 项、Desktop Renderer 8 项、Agent Runtime Client
  24 项测试通过，共 740 项；其中 Web 与 Desktop 扩展顺序基线测试保持原序列。
- `pnpm check:workspace-dependencies` 与 `pnpm lint` 通过。
- `pnpm build` 通过 Runtime Node、Web、Desktop Renderer 与 Desktop Electron artifact 组合。
- 本阶段未创建提交；按验证策略未运行 Browser/E2E，因为迁移后的交互与状态连接均可由类型、单元、
  边界和构建检查确认，没有具体渲染不确定性。

### 6.5 阶段 5：Workspace / Host 垂直切片

按 `contract → Pi implementation → Shell UI` 依次迁移：

- [x] Workspace Directory Picker。
- [x] Project Trust / Local Apps。
- [x] Workspace File。
- [x] Git Branch。

每个切片完成后立即删除相应通用 UI 对 Pi facade 的依赖；Pi 路由、权限、trust、文件流和 Git 行为
保持不变。

实现记录：

- Directory Picker、Workspace File、Git Branch 连同两套基础语言文案迁入 Shell；目录/trust、本地应用、
  文件与 Git 只消费阶段 3 的 Workbench capability/DTO，错误继续由 Pi implementation 统一投影。
- 文件缓冲、diff、草稿与 asset-base lease 由 Shell 拥有；同源内容 URL、Desktop 鉴权 Blob 和渐进文本流
  继续使用既有 Pi transport。预览大小限制提升至 Workbench contract，Pi 保留原常量 export 和数值。
- Pi Contributions 仅为共享文件运行时注入 Skill/Extension 资源 backend；四个专属 opener 随 Toolbox
  激活/卸载，Shell Workspace File 独立拥有通用 opener 与 Surface，没有把 Pi RPC 类型带入 Shell。
- 可选 capability 缺失时隐藏目录、Git、本地应用与工作区文件入口，已恢复的文件 Surface 显示明确不可用状态；
  工作区 backend 缺失不会退回内存写入，文件冲突保留本地编辑和原版本。
- 复用 Shell navigation port 和既有 UI/外观 token；只转移文件查看器依赖归属并复用现有虚拟列表包，
  未增加第三方依赖。Web/Desktop 用 Shell workspace/files 与 Pi runtime groups 交错安装，完整扩展 ID
  序列、设置键和持久化格式不变。Automation 仅更新其复用文案的词典入口，阶段 6 未启动。

验证记录：

- Shell、Pi Contributions、Pi Client、Agent Runtime Contracts、Pi Protocol、Web、Desktop Renderer 定向
  typecheck 全部通过。
- Shell 443 项、Pi Contributions 134 项、Pi Client 278 项测试通过；覆盖缺失 capability、文件冲突、
  安装隔离、opener 卸载/回滚、directory/trust/files/Git RPC 投影与文件流取消。
- 根测试 53 项、Web/Desktop 扩展顺序及边界定向测试 7 项、Host/Trust/Local App/File/Git 路由及架构
  定向测试 27 项通过。权限、请求取消、载体限制和原扩展顺序基线保持不变。
- `pnpm check:workspace-dependencies`、`pnpm lint`、`git diff --check` 与 `pnpm build` 通过；构建覆盖
  Runtime Node、Web、Desktop Renderer 和 Desktop Electron artifact 组合。
- 本阶段代码与此记录一并提交；未运行全仓 `pnpm check` 或 Browser/E2E，最终全量验收仍留待阶段 8。
  本次迁移没有需要 Browser 才能确认的渲染不确定性。

### 6.6 阶段 6：会话级通用能力

- [x] Interactive Requests。
- [x] Side Chat 的 create/restore/release/promote 生命周期。
- [x] Automation，直接复用 `AutomationProtocol`。
- [x] Model Selector；Provider Configuration 留在 Pi。
- [x] Image Understanding，复用 attachment-understanding contracts。
- [x] Token Usage / Context Policy；Context Trace 留在 Pi。
- [x] 所有 Pi error 在实现边界映射。

实施记录（2026-09-04）：

- 六组扩展及测试迁入 `packages/workbench/shell/src/extensions/builtin`；模型选择纯逻辑迁入
  Shell 的 `src/model-selector`，对应双语词典和既有依赖随所有权移动。通用 UI 不再导入 Pi
  Client、Protocol 或 `PiApiError`。
- Interactive Requests 使用 Workbench question/approval DTO 和错误码；Side Chat 复用 scratch
  capability，通过安装时注入的 `WorkbenchBoundSessionProvider` 绑定临时会话，保留 Pi 内部的
  session/command 投影与打开逻辑。模型选择读取最近的会话绑定，不再误用外层会话。
- Automation 复用 `AutomationProtocol`、Workbench host trust 与 Shell 会话导航；Image
  Understanding 复用 attachment contracts。已配置 provider 的过滤和显示名称投影在 Pi model
  capability 内完成，Shell 只接收 Workbench model catalog。
- Context Policy hook 订阅实现方已有状态，不创建第二份缓存；busy、failed、compact 等错误由 Pi
  capability 边界转换。Token Usage 通过现有 opener 判断 Context Trace 入口是否可用，Trace 本身
  继续由 Pi 提供。
- 能力缺失时隐藏功能入口，已恢复的页面显示双语不可用提示；设置、Automation 导航与命令按能力
  presence 注册到现有扩展 registry，卸载时清理，历史工具结果仍可渲染。没有新增 Runtime registry、
  workspace package 或 RPC；扩展 ID、设置键、持久化格式和 Web/Desktop 激活顺序保持兼容。
- 为保持跨所有者的原始顺序，本阶段完成 Shell/Pi 语义化 extension groups 和应用交错组合；公开
  facade 与 Contributions Provider 的剩余清理留在阶段 7。

验证记录（2026-09-04）：

- Core Client 26 项、Pi Client 280 项、Shell 503 项、Pi Contributions 76 项测试通过（共 885
  项），覆盖 capability 缺失/恢复/卸载、嵌套会话绑定、问题/审批响应、scratch 生命周期、模型
  选择和目录过滤、context 错误映射，以及迁移功能的原有测试。
- Root 53 项测试、Web/Desktop 装配与边界 7 项测试通过；扩展 ID 顺序与阶段 1 基线一致。
- Core Contracts、Core Client、Pi Client、Shell、Pi Contributions、Web、Desktop Renderer 类型
  检查通过；`pnpm lint`、`pnpm check:workspace-dependencies` 和 `pnpm build` 通过，构建覆盖
  Runtime Node、Web、Desktop Renderer 和 Desktop Electron artifact 组合。
- 未运行 Browser/E2E；本次迁移的边界、装配和状态行为可由上述检查验证。全仓最终验收仍留在阶段 8。

### 6.7 阶段 7：收缩 Pi Contributions

迁移完成后只保留 Agent Configuration、Provider/Model Configuration、Pi Settings、Toolbox、Context
Trace、External Session Import、Pi Version/Connection Status、Running Indicator 和 branding。

- [x] 缩减 `PiAgentRuntimeContributionsProvider` 的 assets、services 和 contexts。
- [x] 删除无 Pi 专属消费者的公开 facade。
- [x] Shell 与 Pi 导出语义化 extension groups，由应用按基线顺序交错组合（阶段 6 迁移时完成）。
- [x] 不引入动态 registry；保持 extension/command/settings/storage ID 与顺序不变。

实施记录（2026-09-04）：

- `PiAgentRuntimeContributionsProvider` 直接把 Skill/Extension 资源 backend 注入 Shell 文件运行时，
  删除重复的 `PiWorkspaceFileRuntimeProvider` 包装。通用文件缓冲、diff、草稿、assets、workspace target、
  navigation 和 Runtime Connection 继续由 Shell 拥有。
- 删除 `automation`、`interactions`、`side-chat`、`message-metadata`、`threads` 五个无生产消费者的公开入口，
  同步删除 package exports。Host/Workspace 只保留 Pi Version 与 Toolbox 使用的只读订阅；Configuration
  只保留 Agent Settings、Provider 认证与模型配置。资源、Trace 与错误入口移除无消费者的重导出。
- 删除已被 Workbench hooks 替代的 Pi context-policy 与线程批量订阅 hooks；RPC、消息投影、scratch
  binding 和 capability 实现保留在 Pi Client 内部，通用 UI 继续通过 Workbench capability 访问。
- 移除 Contributions 中六项无引用依赖并同步 lockfile；更新 Client/Contributions README 及引用被删除
  入口的扩展 recipe。Shell/Pi 的语义化 groups 与 Web/Desktop 组合顺序保持阶段 6 实现。
- 公开入口边界测试固定剩余九个 subpath，并检查没有未导出的残留 facade 文件。现有资源文件 opener
  测试改为通过真实 Pi installation、Contributions Provider 与 Shell 文件运行时执行；SSR 测试移入
  `test/services`，使 `react-dom/server` 继续只作为开发依赖使用。

验证记录（2026-09-04）：

- Pi Client 280 项、Pi Contributions 76 项测试通过；Web/Desktop 装配及 Shell/全仓 Pi 依赖边界
  12 项定向测试通过，共 368 项。资源 opener 测试移动后单独重跑 4 项通过，原扩展 ID 与激活顺序不变。
- Pi Client、Pi Contributions、Shell、Web、Desktop Renderer 定向 typecheck 通过；测试目录调整后
  Pi Contributions typecheck 再次通过。
- `pnpm check:workspace-dependencies`、`pnpm lint`、`git diff --check` 通过；`pnpm build` 完成
  Runtime Node、Web、Desktop Renderer 与 Desktop Electron artifact 组合。
- 本阶段代码与验证记录一并提交。未运行 Browser/E2E：没有新增交互或渲染变化；全仓 `pnpm check` 与最终文档复核
  留待阶段 8。

### 6.8 阶段 8：清理与收尾

- [ ] 复核 README 中的最终 Pi Runtime Implementation 架构描述。
- [ ] 更新架构、扩展、runtime-node、terminal 和历史计划中的旧路径。
- [ ] 用 `rg --hidden` 清理有效旧路径和错误的结构性 `*Adapter` 名称。
- [ ] 记录每阶段提交、验证结果和最终状态。

## 7. 测试与验收

### 7.1 边界测试

- [x] Shell、Agent Runtime Core、Extension SDK/Host 不直接导入 Pi package。
- [x] Shell 通用扩展不导入 Pi Protocol、Pi Client facade 或 `PiApiError`。
- [x] `packages/agent-runtime/runtimes/pi` 存在，原 Pi 实现目录不存在，隐藏文件和有效文档无旧路径引用。
- [x] Pi 实现中不存在允许名单外的结构性 `*Adapter` 名称。
- [x] `@workbench/agent-runtime-pi-client`、`protocol`、`server`、`contributions` 等 package 名称不变。
- [x] Web 与 Desktop extension ID 序列和阶段 1 基线完全一致。

已勾选项目是阶段 1–2 的当前基线，后续每阶段仍需重跑。

### 7.2 Capability 测试

至少覆盖：capability 缺失、Pi error 映射、Workspace file/Git/directory/trust 成功与失败路径、Interaction
问题与审批、Side Chat 生命周期、model revision/selection、context policy/compact/busy/failed、现有
Automation 与 attachment contracts，以及 Pi raw event 到 Conversation snapshot 的投影隔离。

### 7.3 最终验证顺序

1. 受影响 package 的定向 typecheck 和测试。
2. dependency/boundary tests。
3. `pnpm check`。
4. `pnpm build`。
5. Desktop 打包路径检查。
6. 仅在静态检查无法确认交互、状态同步或渲染时运行 Browser/E2E。

## 8. 完成标准

- [ ] Pi 位于 `packages/agent-runtime/runtimes/pi`，且不再被描述为外部 Adapter 层。
- [ ] Workbench 通用 UI 不依赖 Pi 自定义接口。
- [ ] 前端只通过 Workbench Conversation projection 和 capabilities 判断状态。
- [ ] 通用功能位于 Shell，Pi Contributions 只保留 Pi 专属功能。
- [ ] Workbench-owned Adapter/Port 与 Pi implementation 职责清晰。
- [ ] RPC、持久化、扩展 ID、设置键和激活顺序无回归。
- [ ] 全部边界/定向测试、`pnpm check`、构建和 Desktop 打包检查通过。

## 9. 明确不做

- 不引入第二个 Runtime 或 Runtime 选择 UI。
- 不为未来 Runtime 建立插件注册中心。
- 不创建 generic events 框架。
- 不把 Pi 专属能力强行抽象成 Workbench 接口。
- 不重命名 `@workbench/agent-runtime-pi-*` packages。
- 不修改 Pi RPC wire shape、session 持久化格式或历史数据。
- 不增加第三方依赖。
- 不保留旧路径 barrel、符号链接或兼容层。
