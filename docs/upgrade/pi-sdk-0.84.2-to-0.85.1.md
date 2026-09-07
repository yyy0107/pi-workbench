# Pi SDK 0.84.2 → 0.85.1 版本迭代对比记录

| 项目           | 记录                                                                                       |
| -------------- | ------------------------------------------------------------------------------------------ |
| 核对日期       | 2026-09-07                                                                                 |
| Workbench 基线 | `6f0149dff9d080fb801d47d7ce17ac6d55d96075`                                                 |
| 工作分支       | `chore/adapt-pi-0.85.1`                                                                    |
| 对比基线 SDK   | `@earendil-works/pi-ai@0.84.2`、`@earendil-works/pi-coding-agent@0.84.2`，后者应用本地补丁 |
| 目标 SDK       | `0.85.1`，发布于 2026-09-05；核对时 GitHub 最新稳定版与 npm `latest` 一致                  |
| 状态           | 保留升级前的静态对比；后续实施与验证见 [升级计划及执行记录](pi-sdk-0.85.1-upgrade-plan.md) |
| 用途           | 为后续升级计划提供可追溯的差异、影响范围和验收依据                                         |

版本范围包括 `0.84.3`、`0.84.4`、`0.85.0`、`0.85.1`，不能只检查最后一个补丁版本。目标固定为 `0.85.1`，后续即使出现更新版本，也应另行记录范围变化。[目标发布记录](https://github.com/earendil-works/pi/releases/tag/v0.85.1)

## 1. 对比方法与结论边界

本次依据以下证据，按其用途分别核对：

1. 仓库各工作区的 `package.json`、`pnpm-lock.yaml` 和实际安装包，确认当前声明、解析版本及补丁状态。
2. npm 发布的 `0.85.1` 包，检查 `package.json`、`exports`、核心 `.d.ts` 和相关 `.js`；静态对比阶段仅解包到临时目录，没有安装进工作区。
3. 官方各版本发布记录及 `v0.85.1` 标签下的源码，补充行为变化与变更原因。
4. Workbench 的会话、模型、流协议、工具和 Runtime 打包调用点，判断差异是否实际相关。

“已确认”表示包内容或现有代码足以证明；“待验证”表示需要在升级实现后通过针对性检查确认。本记录不是全量 API 兼容性证明，也不把发布说明中的修复视为已经通过 Workbench 验收。

## 2. 当前依赖基线

### 2.1 直接依赖

共 **5 个工作区包、6 处直接依赖声明**需要纳入后续版本更新。

| 工作区                                 | 当前直接依赖                               | 声明位置                                                                                |
| -------------------------------------- | ------------------------------------------ | --------------------------------------------------------------------------------------- |
| `@workbench/runtime-node`              | `pi-coding-agent: 0.84.2`                  | [apps/runtime-node/package.json](../../apps/runtime-node/package.json)                  |
| `@workbench/agent-runtime-pi-server`   | `pi-ai: 0.84.2`、`pi-coding-agent: 0.84.2` | [server/package.json](../../packages/agent-runtime/runtimes/pi/server/package.json)     |
| `@workbench/agent-runtime-pi-protocol` | `pi-ai: 0.84.2`                            | [protocol/package.json](../../packages/agent-runtime/runtimes/pi/protocol/package.json) |
| `@workbench/agent-runtime-pi-shared`   | `pi-ai: 0.84.2`                            | [shared/package.json](../../packages/agent-runtime/runtimes/pi/shared/package.json)     |
| `@workbench/pi-terminal-tool`          | `pi-coding-agent: 0.84.2`                  | [terminal/pi-tool/package.json](../../packages/terminal/pi-tool/package.json)           |

根 `package.json` 不直接声明 Pi SDK。当前锁文件中的 `pi-agent-core`、`pi-client`、`pi-protocol`、`pi-telemetry`、`pi-tui` 也均为 `0.84.2`；它们属于传递依赖，不应为了版本对齐而额外添加为 Workbench 的直接依赖。[当前锁文件](../../pnpm-lock.yaml)

### 2.2 当前接入方式

Workbench 通过本地 Coding Agent SDK 创建服务和会话，保留 `ModelRuntime` 的模型、认证、请求和资源加载所有权；通过自身 HTTP/WebSocket 协议向前端暴露能力。主要调用链是：

`createWorkbenchAgentSessionServices()` → `createAgentSessionServices()` → `createAgentSessionFromServices()` → `AgentSessionRuntime` → `session.bindExtensions({ mode: "rpc", uiContext })`。

这里的 `mode: "rpc"` 是嵌入会话的扩展绑定模式；Workbench 的网络接口仍由自身 Host 提供。本次没有发现应用代码直接导入 `pi-coding-agent/client`；该字符串出现在 Runtime 构建脚本的解析分支中。[运行时边界说明](../../packages/agent-runtime/runtimes/pi/README.md)、[服务创建](../../packages/agent-runtime/runtimes/pi/server/src/agent-runtime/agent-session-services.ts)、[会话创建与绑定](../../packages/agent-runtime/runtimes/pi/server/src/sessions/session-registry.ts)

## 3. 跨版本变化概览

| 版本     | 日期       | 与此次升级相关的变化                                                                                                                        | Workbench 关注点                                                                                                                                                                                        |
| -------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `0.84.3` | 2026-08-24 | Google thinking 类型重命名；可选 PowerShell 工具；模型/推理选择改为默认会话级；新增压缩失败扩展事件；CLI/RPC 改用 bundle 入口               | 模型默认值语义、工具目录、扩展生命周期、打包入口。[发布说明](https://pi.dev/news/releases/0.84.3)                                                                                                       |
| `0.84.4` | 2026-08-28 | 增加 UI prompt 扩展事件和 RPC `clear_queue`；大工具结果可在下一次模型请求前触发压缩；运行中的 context-only 扩展消息延后至工具结果完成再插入 | 运行状态、队列、工具调用与结果顺序、压缩时序。[发布说明](https://pi.dev/news/releases/0.84.4)                                                                                                           |
| `0.85.0` | 2026-09-04 | 可从外部 entries 恢复内存会话；新增消息帧 API；保留 provider thinking effort；修复工具 cwd、fork 和部分 provider 流问题                     | 会话恢复、流重放、工具覆盖；同时存在发布包 SDK 导入缺陷。[发布说明](https://pi.dev/news/releases/0.85.0)、[Pi AI changelog](https://github.com/earendil-works/pi/blob/v0.85.1/packages/ai/CHANGELOG.md) |
| `0.85.1` | 2026-09-05 | 修复 0.85.0 的 SDK 导入缺陷；实验 client/plugin 入口限源码使用；新增 GPT-6 Astra；修复 GPT-5.6+ Responses 长缓存请求参数                    | 以此版本作为适配目标；核对发布包内容，而非依赖实验入口。[发布说明](https://pi.dev/news/releases/0.85.1)                                                                                                 |

TUI 的全屏搜索、跳到最新消息、指示器、鼠标与选择器修复会随 SDK 依赖更新进入包中，但不等于 Workbench Web/Electron 界面自动获得对应交互，也不是本轮必须增加的 UI 功能。

## 4. 发布包与运行环境差异

以下差异来自已安装 `0.84.2` 与实际发布 `0.85.1` 的 manifest 和文件内容，不仅依据 changelog。[目标 Coding Agent 包元数据](https://registry.npmjs.org/@earendil-works%2Fpi-coding-agent/0.85.1)、[目标 Pi AI 包元数据](https://registry.npmjs.org/@earendil-works%2Fpi-ai/0.85.1)

| 项目                                  | 当前 `0.84.2`                                         | 目标 `0.85.1`                                          | 判断                                                                         |
| ------------------------------------- | ----------------------------------------------------- | ------------------------------------------------------ | ---------------------------------------------------------------------------- |
| Node 要求                             | `>=22.19.0`                                           | `>=22.19.0`                                            | SDK 声明的最低版本没有提高                                                   |
| Coding Agent 根入口                   | `dist/index.js` / `dist/index.d.ts`                   | 相同                                                   | 本地 SDK 仍走模块化根入口                                                    |
| `pi-coding-agent/rpc-entry`           | `dist/rpc-entry.js`                                   | `dist/bundle/rpc-entry.js`                             | 公开入口映射变化；旧模块化文件仍在包内，不能将硬编码旧路径直接认定为文件缺失 |
| CLI `bin.pi`                          | `dist/cli.js`                                         | `dist/bundle/cli.js`                                   | CLI 发布布局变化；不代表 Workbench 应改为启动 Pi CLI                         |
| `pi-coding-agent/client`              | 有 `types` / `import` 和 `dist/client/index.js`       | 仅 `source` 条件；发布包无 `dist/client/index.js`      | 普通消费方不能再按旧客户端入口加载                                           |
| `pi-coding-agent/experimental/plugin` | 无该导出条件                                          | 仅 `source` 条件                                       | 不是可用于本轮正式接入的新运行入口                                           |
| Pi AI 子路径                          | 已有 `api/*`、`providers/*` 等                        | 保留既有路径，增加 `utils/*`                           | 不应误写成全部子路径都是本版新增                                             |
| Coding Agent 运行依赖                 | 含 `pi-client`、`pi-protocol`、`glob`                 | 移除上述三项，新增 `@earendil-works/chord`             | 重新解析真实依赖闭包；不要手工保留旧传递依赖                                 |
| Agent Core 运行依赖                   | 不含 `chord`                                          | 新增 `chord`                                           | 影响 Runtime 制品依赖追踪                                                    |
| Pi AI 运行依赖                        | Anthropic SDK `0.91.1`；直接依赖 `@opentelemetry/api` | Anthropic SDK `0.123.0`；移除该 OpenTelemetry 直接依赖 | SDK 请求路径和制品闭包需回归；不能据此认定整个仓库不再有 OpenTelemetry       |
| Pi 会话文件版本                       | `CURRENT_SESSION_VERSION = 3`                         | 仍为 `3`                                               | 没有版本号层面的迁移要求；已有会话恢复仍须验证                               |

### 4.1 已确认的补丁阻塞

[pnpm-workspace.yaml](../../pnpm-workspace.yaml) 将补丁固定在 `@earendil-works/pi-coding-agent@0.84.2`，补充三个根导出：

- `isStdoutTakenOver`
- `restoreStdout`
- `takeOverStdout`

基线补丁 `patches/@earendil-works__pi-coding-agent@0.84.2.patch` 同时修改 `dist/index.js` 和 `dist/index.d.ts`（升级后由 [0.85.1 等效补丁](../../patches/@earendil-works__pi-coding-agent@0.85.1.patch)替换）。Workbench 通过 [public/installation.ts](../../packages/agent-runtime/runtimes/pi/server/src/public/installation.ts) 将其提供给 [installed-api-only-runtime-host.ts](../../apps/runtime-node/src/installed-api-only-runtime-host.ts)，用于控制 stdout 的接管与恢复。

**已确认：**0.85.1 仍没有这三个根导出，但 `dist/core/output-guard.js` 仍存在，且与当前安装版本内容一致。在解包后的 0.85.1 上执行旧补丁的 `git apply --check`，失败于 `dist/index.d.ts` 的上下文匹配；新版导出列表已发生变化。

**后续动作：**为 0.85.1 重新生成等效的最小补丁，并更新补丁注册和锁文件。不能只改补丁文件名，也不能删除补丁后继续保留当前根导入。此处是 Workbench 自有补丁未被上游吸收，不应描述为上游删除了原本公开的 stdout API。

### 4.2 Runtime 构建路径需要复核

[build-runtime-artifact.ts](../../apps/runtime-node/scripts/build-runtime-artifact.ts) 的自定义依赖解析器硬编码了以下路径：

- `pi-coding-agent` → `dist/index.js`：与目标根入口一致。
- `pi-coding-agent/rpc-entry` → `dist/rpc-entry.js`：目标公开映射已改为 bundle，旧文件仍存在，需要明确保留该映射的理由或按公开入口调整。
- `pi-coding-agent/client` → `dist/client/index.js`：目标发布包已无该文件，应核对是否仍有实际追踪调用，并清理或调整过时分支。

构建的 `runtimeTraceEntries` 将 Pi AI 和 Coding Agent 发布包的全部 `dist` JavaScript 纳入 NFT roots，包括 bundle；追踪范围不止根 SDK 的运行时导入图。后续核对仓库和目标发布包的 JavaScript 后，没有发现这两个子路径的包导入调用者，因此实施时删除 `/rpc-entry`、`/client` 的过时精确映射，保留根入口映射和完整发布树。升级后仍须检查真实制品，不能仅以源码 typecheck 通过作为打包兼容证据。

## 5. SDK API 与项目调用对照

### 5.1 必须审视的兼容性与行为变化

| 差异                                                                                                                    | 当前项目证据                                                                                                           | 后续处理依据                                                                                                                                                                                                                        |
| ----------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `setModel`、`cycleModel`、`setThinkingLevel`、`cycleThinkingLevel` 增加可选 `{ persist?: boolean }`；默认不写全局默认值 | `session-registry.ts` 的 `applyPromptSelection()`、`selectModel()` 无 options 调用 `setModel()` / `setThinkingLevel()` | 编译可以继续通过，但行为已变。分别验证“本会话选择”“新会话默认值”“显式保存默认值”，不要无差别补 `persist: true`。[目标实现](https://github.com/earendil-works/pi/blob/v0.85.1/packages/coding-agent/src/core/agent-session.ts)       |
| Pi AI `GoogleThinkingLevel` → `GoogleApiThinkingLevel`，另增 `ResolvedGoogleThinkingLevel`                              | 对应用及 packages 的 TS/JS 源码搜索未发现旧类型使用                                                                    | 当前未发现直接改名工作；后续 typecheck 确认外部扩展和间接类型边界。[Pi AI changelog](https://github.com/earendil-works/pi/blob/v0.85.1/packages/ai/CHANGELOG.md)                                                                    |
| Cloudflare `createGatewayBindingFetch()` → `createAiBindingFetch()`；网关 passthrough `baseUrl` 由模型配置              | 同一源码范围未发现旧函数使用                                                                                           | 当前未发现直接迁移点；若接入 Cloudflare binding，再使用 `pi-ai/api/cloudflare-ai-binding` 的新契约。[目标 binding 实现](https://github.com/earendil-works/pi/blob/v0.85.1/packages/ai/src/api/cloudflare-ai-binding.ts)             |
| Agent Core 的 `prepareNextTurn` / `prepareNextTurnWithContext` 不再在最终或终止 turn 后调用                             | 未发现 Workbench 直接使用这两个 hook 或 `AgentHarness`                                                                 | 不需要凭空引入 hook 适配；应回归通过 Coding Agent 间接受影响的压缩和运行结束时序。上游明确将 end-of-run 工作放到 `agent_end`。[Agent Core changelog](https://github.com/earendil-works/pi/blob/v0.85.1/packages/agent/CHANGELOG.md) |
| `ExtensionAPI.registerFlag()` 的类型和默认值改为匹配的判别联合                                                          | 未发现 Workbench 源码调用 `registerFlag()`                                                                             | 内部暂无直接修改；用户扩展的错误默认值会被更严格检查。[目标扩展类型](https://github.com/earendil-works/pi/blob/v0.85.1/packages/coding-agent/src/core/extensions/types.ts)                                                          |

核对选定核心声明后，`agent-session-services.d.ts`、`resource-loader.d.ts` 与当前版本内容一致，`createAgentSessionFromServices` 等现有构造入口保留。因此没有证据要求重建 Workbench 的会话或资源加载架构；方法签名保持兼容不代表内部行为完全不变。

### 5.2 新能力：区分升级必需与后续采用

| 新能力                   | 目标接口或行为                                                                      | 当前关系与建议                                                                                                                                                                                                                                                                                                                 |
| ------------------------ | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 从外部恢复内存会话       | `SessionManager.inMemory(cwd?, options?, entries?: FileEntry[])`                    | 当前调用仍使用原参数；正常会话由 Pi 管理 JSONL。保留现有持久化，外部存储方案可在有需求时使用第三参数。[目标 SessionManager](https://github.com/earendil-works/pi/blob/v0.85.1/packages/coding-agent/src/core/session-manager.ts)                                                                                               |
| 可持久化消息帧           | `AssistantMessageFrameEncoder`、`reduceAssistantMessageFrames()`                    | 与现有 `pi-messages-v1` 有能力重叠，但结构并不相同；先验证旧协议，单独评估复用。[目标 frame 实现](https://github.com/earendil-works/pi/blob/v0.85.1/packages/ai/src/utils/assistant-message-frame.ts)                                                                                                                          |
| Provider thinking effort | `AssistantMessage.providerThinkingLevel?`，Pi Messages 终态新增同名可选字段         | 需要确认 SDK 会话落盘/恢复保留该信息。Workbench 的 `PiAssistantMessage` 未声明该字段，但元数据复制使用对象展开，不能仅凭类型缺失断言运行时丢失。[目标消息类型](https://github.com/earendil-works/pi/blob/v0.85.1/packages/ai/src/types.ts)                                                                                     |
| 压缩失败事件             | `pi.on("session_compact_failed", handler)`，包含原因、取消、重试和扩展来源信息      | 可改善诊断；这是扩展事件，不等于现有 Workbench 网络事件自动增加该类型。[目标扩展类型](https://github.com/earendil-works/pi/blob/v0.85.1/packages/coding-agent/src/core/extensions/types.ts)                                                                                                                                    |
| UI prompt 事件           | `ui_prompt_start` / `ui_prompt_end`                                                 | Workbench 已由 `InteractiveResponseRegistry` 提供等待用户状态。若采用新事件，应通过现有状态所有者适配，避免重复计时或维护两套等待状态。[现有交互注册表](../../packages/agent-runtime/runtimes/pi/server/src/sessions/interactive-response-registry.ts)                                                                         |
| RPC `clear_queue`        | 取出并清空 steering / follow-up 队列                                                | Workbench 已调用 `session.clearQueue()` 并维护自身队列 RPC；新增 stdio RPC 命令不构成替换理由。[目标 RPC 说明](https://github.com/earendil-works/pi/blob/v0.85.1/packages/coding-agent/docs/rpc.md)                                                                                                                            |
| Deferred 流              | `Models.streamDeferred()`、`ModelRuntime.streamDeferred()`                          | 当前宿主包装 `stream`、`streamSimple`、`fetchDeferred`、`cancelDeferred` 以注入受控 fetch；未包装新增方法。现有 `fetchDeferred` 包装仍会传入 options，但未来直接调用 `streamDeferred` 时应纳入同一护栏。[目标 ModelRuntime](https://github.com/earendil-works/pi/blob/v0.85.1/packages/coding-agent/src/core/model-runtime.ts) |
| 自定义模型兼容           | `vllmPriority`、`supportsMaxOutputTokens`，以及中间版本增加的 reasoning budget 配置 | 通过现有模型配置和 `ModelRuntime` 验证，无需为每个新增字段立即增加 UI。[Pi AI 类型](https://github.com/earendil-works/pi/blob/v0.85.1/packages/ai/src/types.ts)                                                                                                                                                                |
| PowerShell               | `createPowerShellTool()` / `createPowerShellToolDefinition()` 等                    | Workbench 有自己的终端 bash override、工具偏好和来源标记；本次升级不自动增加独立 PowerShell 产品能力。[当前工具组合](../../packages/agent-runtime/runtimes/pi/server/src/internal-extensions/builtin-tools/index.ts)                                                                                                           |

## 6. 现有行为的重点回归范围

### 6.1 消息流、持久化与恢复

当前 [protocol/src/stream.ts](../../packages/agent-runtime/runtimes/pi/protocol/src/stream.ts) 使用 `PiMessagesEvent` 的内容事件，并排除 `start`、`done`、`error`；服务器将它们写成 `format: "pi-messages-v1"` 的持久化 chunk，客户端由共享 reducer 和 accumulator 重建。

上游仍保留 `PiMessagesEvent`。新增的 `AssistantMessageFrame` 包含不同形状的 block 数据和 `toolcall_checkpoint`，其 encoder 不承担最终消息终态持久化。因此不能把现有 delta 类型直接替换成新 frame 类型；需要继续保留最终 `message_end` 的权威修正、revision、重连快照和历史兼容。[目标 Pi Messages 协议](https://github.com/earendil-works/pi/blob/v0.85.1/packages/ai/src/api/pi-messages.ts)、[目标 frame 协议](https://github.com/earendil-works/pi/blob/v0.85.1/packages/ai/src/utils/assistant-message-frame.ts)

下一步应以交错 text/thinking/tool-call、部分 JSON、请求开始前失败、签名和最终消息元数据、重连与历史重放为代表场景。现有 `copyPiAssistantMessage()` 和 `assistantMessageMetadata()` 会复制额外字段；需验证端到端是否保留新字段，而不是先认定必须修改所有 DTO。[共享 reducer](../../packages/agent-runtime/runtimes/pi/shared/src/messages/reducer.ts)、[客户端 accumulator](../../packages/agent-runtime/runtimes/pi/client/src/transport/session-message-accumulator.ts)

### 6.2 压缩、fork 与消息顺序

中间版本和目标版涉及：工具结果后、下一次模型调用前的自动压缩；context-only 扩展消息插入顺序；JSONL 末尾缺少换行的追加；fork 压缩边界；活动 turn 尚未结束时的内存会话 fork；手动压缩取消和摘要截断处理。[0.84.4 发布说明](https://pi.dev/news/releases/0.84.4)、[0.85.0 发布说明](https://pi.dev/news/releases/0.85.0)

Workbench 的 [session-registry.ts](../../packages/agent-runtime/runtimes/pi/server/src/sessions/session-registry.ts) 同时拥有 prompt、队列、取消、上下文策略及会话状态投影；[session-context-trace.ts](../../packages/agent-runtime/runtimes/pi/server/src/sessions/session-context-trace.ts) 消费 compaction/retry 生命周期。因此即使升级后类型检查通过，也需要针对事件顺序和运行结束状态做回归。

### 6.3 工具执行与扩展加载

0.85.0 修复内置工具忽略 `ctx.cwd`；0.84.3 改善扩展工厂失败后的注册清理、skills 发现和 edit 参数兼容。[0.85.0 发布说明](https://pi.dev/news/releases/0.85.0)、[0.84.3 发布说明](https://pi.dev/news/releases/0.84.3)

[终端适配器](../../packages/terminal/pi-tool/src/index.ts) 基于 `createBashToolDefinition()` 提供自定义 `operations.exec()`，并把执行上下文继续传给原工具。应验证最终到达终端的 cwd、超时、取消、输入归属和输出仍正确；增强搜索覆盖和失败扩展清理也应使用现有测试验证。不能因为 Pi 内置工具已修复，就假设所有 Workbench override 自动等价。

### 6.4 模型、认证与请求参数

模型目录和 provider 适配会随 SDK 更新：例如 GPT-6 Astra、Claude effort/签名恢复、Codex SSE 结束事件解析，以及 GPT-5.6+ Responses 使用 `prompt_cache_options.ttl: "30m"` 的长缓存修复。应通过现有模型服务验证目录解析与请求选项；不要在 Workbench 复制上游模型目录。[0.85.1 发布说明](https://pi.dev/news/releases/0.85.1)、[Pi AI changelog](https://github.com/earendil-works/pi/blob/v0.85.1/packages/ai/CHANGELOG.md)

请求检查优先使用结构化 fake 或已安装的测试能力，不依赖真实付费模型请求。当前宿主 fetch 隔离逻辑需要保留，并检查新增 Deferred 入口是否进入实际调用范围。[模型请求适配](../../packages/agent-runtime/runtimes/pi/server/src/agent-runtime/agent-session-services.ts)

## 7. 后续升级计划的输入

以下是本次对比产生的候选工作顺序，不代表已经实施或通过验收。

| 优先级 | 工作项                                                                             | 完成证据                                                                    |
| ------ | ---------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| P0     | 更新 5 个工作区的 6 处 SDK 声明，重新生成 0.85.1 stdout 补丁，交由 pnpm 更新锁文件 | 当前直接依赖一致；补丁成功应用；不存在意外混装的 SDK 运行实例               |
| P0     | 复核 Runtime 的 RPC/client 解析分支和新依赖闭包                                    | 制品构建及相关测试通过；没有指向未发布客户端文件的实际解析路径              |
| P1     | 确认模型选择与全局默认值的产品语义                                                 | 会话切换、保存默认值、新建会话分别有可验证结果                              |
| P1     | 回归流、压缩、恢复、fork、队列和取消                                               | 现有针对性测试通过；新增测试只覆盖实际变化且未覆盖的行为                    |
| P1     | 回归扩展绑定、失败清理、工具 cwd 与终端 override                                   | 生命周期、工具执行和项目隔离保持正确                                        |
| P1     | 检查随产品分发的 Pi 文档快照和开发技能引用                                         | 保持明确的版本标记；若更新快照，依据目标正文重新生成/核对，不能只替换版本号 |
| P2     | 按实际需求评估 frame API、外部内存会话恢复、UI prompt 事件等                       | 独立确认收益和迁移边界，不作为完成基础升级的前置条件                        |

文档同步范围包括 [内置 pi-docs](../../packages/agent-runtime/runtimes/pi/server/src/skills/builtin-skills/pi-docs/SKILL.md) 及其 `references/`（当前明确标记 0.84.2），以及 [Pi AI 技能](../../.agents/skills/pi-ai-sdk/SKILL.md)、[Coding Agent source-routing](../../.agents/skills/pi-coding-agent-sdk/references/source-routing.md) 中的入口说明。后者当前将 `./client` 列为可用包入口，需在升级时按新发布条件修正。

### 7.1 可复用的验证入口

| 验证面                 | 已有测试或命令                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 核心 SDK 与宿主类型    | 对 `@workbench/agent-runtime-pi-protocol`、`@workbench/agent-runtime-pi-shared`、`@workbench/agent-runtime-pi-server`、`@workbench/pi-terminal-tool`、`@workbench/runtime-node` 运行各自 `typecheck`；接口变动时补查客户端                                                                                                                                                                                                                                                                                                                                                                                             |
| stdout / Host 生命周期 | [installed-api-only-runtime-host.test.ts](../../apps/runtime-node/test/installed-api-only-runtime-host.test.ts)、[package-control-stdout.test.ts](../../apps/runtime-node/test/package-control-stdout.test.ts)、[session-extension-lifecycle.test.ts](../../apps/runtime-node/test/session-extension-lifecycle.test.ts)                                                                                                                                                                                                                                                                                                |
| Runtime 制品           | [runtime-artifact-builder.test.ts](../../apps/runtime-node/test/runtime-artifact-builder.test.ts)、`pnpm --filter @workbench/runtime-node build`；必要时运行该包的 `smoke:native`                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| 流重建                 | [reducer.test.ts](../../packages/agent-runtime/runtimes/pi/shared/test/reducer.test.ts)、[session-message-accumulator.test.ts](../../packages/agent-runtime/runtimes/pi/client/test/transport/session-message-accumulator.test.ts)                                                                                                                                                                                                                                                                                                                                                                                     |
| 会话与上下文           | [session-queue.test.ts](../../packages/agent-runtime/runtimes/pi/server/test/sessions/session-queue.test.ts)、[session-interruption.test.ts](../../packages/agent-runtime/runtimes/pi/server/test/sessions/session-interruption.test.ts)、[session-resume.test.ts](../../packages/agent-runtime/runtimes/pi/server/test/sessions/session-resume.test.ts)、[session-context-policy.test.ts](../../packages/agent-runtime/runtimes/pi/server/test/sessions/session-context-policy.test.ts)、[session-context-trace.test.ts](../../packages/agent-runtime/runtimes/pi/server/test/sessions/session-context-trace.test.ts) |
| 模型与请求隔离         | [model-service.test.ts](../../packages/agent-runtime/runtimes/pi/server/test/models/model-service.test.ts)、[model-request-transport.test.ts](../../packages/agent-runtime/runtimes/pi/server/test/models/model-request-transport.test.ts)                                                                                                                                                                                                                                                                                                                                                                             |
| 内置工具与终端         | [builtin-tools.test.ts](../../packages/agent-runtime/runtimes/pi/server/test/internal-extensions/builtin-tools.test.ts)、[interactive-bash-tool.test.ts](../../packages/terminal/pi-tool/test/interactive-bash-tool.test.ts)                                                                                                                                                                                                                                                                                                                                                                                           |

定向运行示例（仓库根目录执行，留给升级实施阶段）：

```bash
pnpm --filter @workbench/agent-runtime-pi-server typecheck
node --no-warnings=ExperimentalWarning \
  --import ./scripts/register-typescript-test-loader.mjs \
  --test packages/agent-runtime/runtimes/pi/shared/test/reducer.test.ts
```

现有测试是复用入口，不表示已覆盖所有新增边界。按实际改动选用检查；只有出现具体的浏览器同步、渲染或交互不确定性，才使用 Browser/E2E。静态对比阶段仅新增本文，未运行应用测试、构建、Browser 或真实模型请求；后续结果单独记录。

## 8. 静态对比阶段的验收状态

- 已确认当前声明、实际安装版本、锁文件和 stdout 补丁。
- 已比较 0.85.1 发布包的依赖、入口、选定核心声明与相关实现。
- 已覆盖 0.84.3 → 0.85.1 的中间版本变化，并映射至项目调用点。
- 已在临时解包目录完成旧补丁的适用性检查，确认需重建类型导出补丁。
- 已列出必需适配、行为待验证项和可选采用能力。
- 截至静态对比阶段，尚未修改 SDK 版本、补丁、锁文件、运行时代码或现有文档快照；上述静态结论不等于运行验收。

## 9. 后续实施

升级实施已统一六处依赖声明为 `0.85.1`、重建 stdout 导出补丁，并声明可选的 `providerThinkingLevel` 消息字段。模型切换采用会话级语义，Workbench 自身的 UI 模型记忆继续保留。真实构建另暴露并修复了新版 Anthropic SDK 技能路径引起的 NFT 仓库误追踪：import/require 两次追踪改用候选制品工作目录，继续显式复制正式资源。

六个包类型检查、259 项不重复定向测试、Linux x64 Runtime 构建、仓库外 SDK 导入与实际 Host 安装文档定位均已通过。阶段状态、回归证据、实际构建结果及平台范围统一维护在 [升级计划及执行记录](pi-sdk-0.85.1-upgrade-plan.md)，以免覆盖本文的原始对比基线。
