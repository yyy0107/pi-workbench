# Workbench Agent Runtime 边界与 Pi 实现重构计划

实施状态与逐阶段提交、验证记录维护在
[`agent-runtime-pi-implementation-refactor-plan.md`](./agent-runtime-pi-implementation-refactor-plan.md)。
阶段 1–8 已完成，最终验收通过（2026-09-04）。

## 文档交付

新增 `docs/agent-runtime-pi-implementation-refactor-plan.md`，内容按本计划编写，并在实施过程中使用复选框记录各阶段状态。

该文档作为已经完成的 `assistant-ui-removal-and-custom-runtime-plan.md` 的后续架构计划；不修改前一份计划的“已完成”结论。

## 总结

本次重构解决的核心问题不是简单改名，而是重新建立所有权边界：

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

重构完成后：

- `Adapter` 是 Workbench 定义的架构概念。
- Pi 是 Workbench Agent Runtime 的一个具体实现。
- Pi Runtime 移入 `packages/agent-runtime/runtimes/pi`，原 Pi Adapter 子树不保留兼容层。
- 通用前端功能只依赖 Workbench 类型和能力接口，不再依赖 Pi Protocol、Pi Client facade 或 `PiApiError`。
- Pi 原始事件继续保留在 Pi 实现内部，前端通过 Workbench 的 `ConversationNode`、`MessageBlock`、运行状态和能力接口判断 UI。
- 不新增通用原始 `AgentEvent`、运行时注册中心、新 workspace package 或第二套 RPC 框架。
- 现有 `@workbench/agent-runtime-pi-*` package 名称保持不变，只移动物理目录。
- 现有 RPC 方法、WebSocket 事件、持久化格式、扩展 ID、设置键及 UI 激活顺序保持兼容。

当前基线记录到计划文档中：

- Core Contracts、Runtime、Client、Workbench Shell 和 Extension SDK/Host 当前没有直接导入 Pi package。
- Pi Contributions 中约有 71 个生产文件直接依赖 Pi Client 或 Pi Protocol。
- 应用层是具体运行时的组合入口，Web 与 Desktop 继续在这一层选择并安装 Pi Runtime。

## 所有权与能力划分

| 功能                                                                 | 重构后的所有者             | 处理方式                                                        |
| -------------------------------------------------------------------- | -------------------------- | --------------------------------------------------------------- |
| Conversation timeline、message blocks、running/loading/composer 状态 | Workbench Agent Runtime    | 继续使用现有 Core Contracts 与 Runtime                          |
| Workspace explorer、workspace review                                 | Workbench Shell            | 直接迁移，删除 Pi 命名的安装服务                                |
| Workspace directory、project trust、local app、file、Git             | Workbench                  | 定义最小能力接口，Pi 实现现有行为                               |
| Terminal                                                             | Workbench Terminal + Shell | 复用现有 terminal contracts/client 和 Shell `RuntimeConnection` |
| Automation                                                           | Workbench Automation       | 复用现有 `AutomationProtocol`，Pi 只提供实现                    |
| Model Selector                                                       | Workbench                  | 使用通用 `ModelSelection` 和 Workbench model capability         |
| Interactive Requests                                                 | Workbench                  | 使用 Workbench interaction capability                           |
| Side Chat                                                            | Workbench                  | 使用通用 scratch-session capability                             |
| Token Usage / Context Policy                                         | Workbench                  | 使用通用 context capability                                     |
| Agent Configuration                                                  | Pi                         | 保留在 Pi Contributions                                         |
| Provider / Model Configuration                                       | Pi                         | 保留在 Pi Contributions                                         |
| Pi Settings                                                          | Pi                         | 保留在 Pi Contributions                                         |
| Toolbox、Pi packages/skills/extensions/prompts                       | Pi                         | 保留在 Pi Contributions                                         |
| Context Trace                                                        | Pi                         | 保留在 Pi Contributions                                         |
| External Session Import                                              | Pi                         | 保留在 Pi Contributions                                         |
| Pi Version、Connection Status、Running Indicator、Pi branding        | Pi                         | 保留在 Pi Contributions                                         |

Model Selector 只负责当前会话的通用模型选择；provider 认证、模型源配置及 Pi 专属配置继续属于 Pi。

Context Policy 和 Token Usage 上提为 Workbench 能力；展示 Pi 内部事件和实现细节的 Context Trace 不上提。

## Workbench 公共接口调整

### 1. 扩展现有 Runtime Environment

在现有 `@workbench/agent-runtime-client` 中扩展 `WorkbenchAgentRuntimeEnvironment`，增加可选的、只读的能力集合，不创建新 package：

```ts
interface WorkbenchAgentRuntimeCapabilities {
  host?: WorkbenchRuntimeHostCapability;
  workspace?: WorkbenchWorkspaceCapability;
  models?: WorkbenchModelSelectionCapability;
  interactions?: WorkbenchInteractionCapability;
  scratchSessions?: WorkbenchScratchSessionCapability;
  context?: WorkbenchContextCapability;
  automation?: AutomationProtocol;
}
```

约束：

- 每个能力只包含当前被通用 UI 实际使用的方法，不为未来运行时预留空接口。
- 通用 DTO 放入现有的 Workbench contracts package：
  - host、directory、local-app、trust 类型归入 host contracts；
  - workspace、file、Git、model、interaction、scratch-session、context 类型归入 agent-runtime contracts；
  - automation、attachment、terminal 继续复用现有领域 contracts。
- Pi Protocol 可以在实现内部使用或映射这些 Workbench 类型，但 Shell 不得导入 Pi Protocol。
- 提供按能力拆分的 hooks；通用组件读取对应能力，不根据 `runtime.id === "pi"` 分支。
- 能力不存在时不安装或不显示相应入口；恢复出来的历史 UI 状态可以显示明确的 unsupported 状态，但不得注入假实现或 no-op capability。

### 2. 统一通用错误边界

在 Workbench Client 中增加 `WorkbenchAgentCapabilityError`，包含稳定的 `code` 和可选 `details`。

Pi 实现负责把 `PiApiError` 映射为 Workbench 错误。迁移后的 Shell UI：

- 不导入或执行 `instanceof PiApiError`。
- 只根据 Workbench 错误 code 决定冲突、不可用、未找到、请求已结束、运行中等 UI 状态。
- 不暴露 Pi HTTP/RPC transport 细节。

### 3. 保持 Server Adapter 职责克制

保留 Workbench 定义的 `WorkbenchAgentServerAdapter`。它继续负责 agent commands、execution 和 threads，不扩展为容纳所有功能的 service locator。

Workspace、host、terminal、automation、attachment 等能力继续使用各自的 Workbench domain ports；Pi Server 在组合层实现或绑定这些 ports。

### 4. 不新增通用原始事件层

不新增 `WorkbenchAgentEvent` 或对 Pi 所有事件逐项复制的枚举。

事件处理边界固定为：

- Pi session/raw events 只存在于 `runtimes/pi`。
- Pi Client projection 将其转换为现有 `ConversationNode`、`MessageBlock`、snapshot 状态和 Workbench capabilities。
- Shell 根据 Workbench 投影结果和 capability presence 渲染 UI，不理解 Pi event name。

## 命名与目录规则

### 目录移动

原子移动：

```text
原 Pi Adapter 子树
→ packages/agent-runtime/runtimes/pi
```

同步更新：

- `pnpm-workspace.yaml`
- `pnpm-lock.yaml` importer 路径
- Web/Desktop CSS source globs
- 构建、依赖边界及打包脚本
- 单元测试中的路径常量
- README、docs 及隐藏的 `.agents/skills` 引用
- Web/Desktop 应用组合入口

不保留旧目录、兼容 barrel 或符号链接。

### Pi 实现命名

Pi Runtime 内不再使用架构意义上的 `Adapter` 命名（下表旧名称仅用于迁移对照）：

| 当前名称                           | 新名称                                    |
| ---------------------------------- | ----------------------------------------- |
| `createPiAgentServerAdapter`       | `createPiAgentServerImplementation`       |
| `PiAgentServerAdapterDependencies` | `PiAgentServerImplementationDependencies` |
| `createPiAgentExecutionAdapter`    | `createPiAgentExecution`                  |
| `createPiAgentThreadStoreAdapter`  | `createPiAgentThreadStore`                |
| `session-rpc-adapter.ts`           | `session-rpc-projection.ts`               |
| `ExternalSessionSourceAdapter`     | `ExternalSessionImporter`                 |
| Codex/Claude/Cursor source adapter | 对应的 `*SessionImporter`                 |

保留以下名称：

- Workbench 定义的 `WorkbenchAgentServerAdapter`。
- 第三方 API、兼容协议或持久化数据里的既有字面量，例如 `modelsSource: "adapter"`；仅为了词汇统一不修改 wire shape。

## 实施阶段

### 阶段 1：建立边界保护

- 在现有 dependency/boundary tests 中明确：
  - Core、Shell、Extension SDK/Host 禁止导入 `@workbench/agent-runtime-pi-*`。
  - Pi package 只能从应用组合入口和 `runtimes/pi` 内部引用。
  - Shell 通用扩展不得导入 Pi Protocol、Pi Client facade 或 Pi error。
- 保存当前扩展 ID 和激活顺序快照，作为后续迁移的兼容基线。
- 在计划文档中记录当前依赖统计和阶段状态。

### 阶段 2：移动目录并纠正结构命名

- 将整个 Pi Runtime 移入 `packages/agent-runtime/runtimes/pi`。
- 更新 workspace、锁文件、构建、CSS 扫描、测试、文档和 skill 路径。
- 完成 Pi Runtime 内结构性 `Adapter` 重命名。
- 保持所有 package name、export name 中已公开且不表达错误架构含义的部分稳定。
- 单独提交这一机械阶段，避免与能力迁移混合。

### 阶段 3：增加最小 Workbench Capability 层

- 扩展现有 Runtime Environment 和 provider props。
- 定义通用 DTO、能力接口、窄 hooks 和 capability error。
- 由 `PiAgentRuntimeProvider` 使用现有 Pi facade/RPC 组装 `WorkbenchAgentRuntimeCapabilities`。
- 保持 Pi facade 暂时存在，先作为实现内部桥接；只有在所有消费者迁移后才删除未使用 export。
- 为每个 capability 增加一个最小 contract/projection 测试，不建立通用 capability registry。

### 阶段 4：迁移已经与 Pi 无关的通用扩展

先移动无需新协议设计的功能：

- Workspace Explorer
- Workspace Review
- Terminal

同时：

- 将 Pi 命名的 workspace target、Git review 安装服务改为 Shell 所有的服务。
- Terminal 改用现有 Shell `useRuntimeConnection`，删除重复的 Pi Runtime Connection context。
- 将 file viewer asset base 等通用资源放入现有 Workbench assets/provider。
- 将这些扩展的 `en-US`、`zh-CN` 文案随组件迁入 Shell。

### 阶段 5：迁移 Workspace / Host 垂直切片

按“contract → Pi implementation → Shell UI”的顺序迁移：

- Workspace Directory Picker
- Project Trust / Local Apps
- Workspace File
- Git Branch

要求：

- Shell 只看到 Workbench DTO 和 capability。
- Pi 路由、权限检查、trust 逻辑、文件流和 Git 行为保持不变。
- 文件内容 URL、stream 等实现细节通过 capability 返回稳定 Workbench 值，不把 Pi route 类型泄露给 Shell。
- 每完成一个垂直切片即删除对应通用 UI 对 Pi facade 的依赖。

### 阶段 6：迁移会话级通用能力

依次迁移：

- Interactive Requests
- Side Chat
- Automation
- Model Selector
- Token Usage / Context Policy

要求：

- Interaction 统一使用 Workbench question/approval 请求和响应类型。
- Side Chat 使用通用 scratch-session 生命周期：create、restore、release、promote。
- Automation 直接复用现有 Workbench Automation Protocol。
- Model Selector 使用 Workbench model catalog/selection/revision 能力；Provider Configuration 保留在 Pi。
- Token Usage 读取 Workbench context budget/policy；Context Trace 仍读取 Pi 专属接口。
- 所有 Pi errors 在实现边界完成映射。

### 阶段 7：收缩 Pi Contributions

完成迁移后，Pi Contributions 仅保留：

- Agent Configuration
- Provider / Model Configuration
- Pi Settings
- Toolbox
- Context Trace
- External Session Import
- Pi Version / Connection Status
- Pi Running Indicator 和 branding

随后：

- 缩减 `PiAgentRuntimeContributionsProvider`，移除已迁入 Shell 的 assets、services 和 contexts。
- 删除没有 Pi 专属消费者的公开 facades；内部 transport/projection helper 可以保留。
- Web 和 Desktop 仍是运行时选择与组合入口。
- Shell 与 Pi 分别导出语义化 extension groups，应用层按现有 ID 顺序交错组合；不引入动态 registry。
- 保持现有 extension ID、command ID、settings key、storage key 和激活顺序不变。

### 阶段 8：清理与文档收尾

- 复核 Pi Runtime README 的最终架构描述。
- 更新架构、扩展、runtime-node、terminal 和已完成迁移计划中的旧路径。
- 使用 `rg --hidden` 清理旧目录引用及错误的 Pi `*Adapter` 架构命名。
- 在本计划文档中记录每阶段提交、验证结果和最终完成状态。

## 测试与验收

### 边界测试

必须证明：

- `packages/workbench/shell`、Agent Runtime Core、Extension SDK/Host 不直接导入 Pi package。
- Shell 通用扩展不导入 Pi Protocol、Pi Client facade 或 `PiApiError`。
- `packages/agent-runtime/runtimes/pi` 存在，原 Pi 实现目录不再存在，隐藏文件和文档中无有效旧路径引用。
- Pi Runtime 内不存在未列入允许名单的结构性 `*Adapter` 名称。
- `@workbench/agent-runtime-pi-client`、`protocol`、`server`、`contributions` 等 package 名称不变。
- Web 与 Desktop 的 extension ID 序列和迁移前完全一致。

### 能力测试

至少覆盖：

- 缺少可选 capability 时，对应入口隐藏或显示明确 unsupported 状态。
- Pi error 正确映射为 Workbench capability error。
- Workspace file、Git、directory/trust 的核心成功与失败路径。
- Interaction 的问题、审批、已结束请求和非法响应。
- Side Chat create/restore/release/promote 生命周期。
- Model revision 和 session selection 更新。
- Context policy 更新、compact、busy/failed 状态。
- Automation 继续通过现有 Workbench contracts 工作。
- Pi raw event 仍正确投影到现有 Conversation snapshot，不进入 Shell。

### 最终验证

按风险比例执行：

1. 受影响 package 的定向 typecheck 和测试。
2. 现有 dependency/boundary tests。
3. `pnpm check`。
4. `pnpm build`。
5. 执行 Desktop 打包路径检查，确认目录移动没有遗漏 runtime artifact。
6. 只有出现无法通过静态检查确认的交互或状态同步问题时才启动 Browser/E2E；纯目录、类型和命名迁移不做机械浏览器验证。

## 完成标准

同时满足以下条件才将计划标记为完成：

- Pi 位于 `packages/agent-runtime/runtimes/pi`，且不再被描述为 Workbench 外部的“Adapter 层”。
- Workbench 通用 UI 不依赖 Pi 自定义接口。
- 前端通过 Workbench conversation projection 和 capabilities 判断，不解析 Pi 原始事件。
- 通用功能位于 Shell，Pi Contributions 只保留 Pi 专属功能。
- Workbench-owned Adapter/Port 与 Pi implementation 的职责清晰。
- 现有 UI 功能、RPC 行为、持久化数据、扩展 ID、设置键及激活顺序没有回归。
- 所有边界测试、定向测试、`pnpm check`、构建和 Desktop 打包检查通过。

## 明确不做

- 不引入第二个运行时或运行时选择 UI。
- 不为未来运行时建立插件注册中心。
- 不创建新的 generic events 框架。
- 不把所有 Pi 专属能力强行抽象成 Workbench 接口。
- 不重命名现有 `@workbench/agent-runtime-pi-*` packages。
- 不修改 Pi RPC wire shape、会话持久化格式或历史数据。
- 不增加新依赖。
- 不保留旧路径兼容层。
