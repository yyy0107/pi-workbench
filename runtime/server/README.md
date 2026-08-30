# Workbench Server Runtime

`runtime/server` 保存 Workbench 自己拥有、只在宿主服务端运行的应用服务。后端无关的 Agent Runtime
端口由 `@workbench/agent-runtime-server` 独立拥有。这里不放 React 状态、具体 Agent SDK 对象或实现专属
事件模型。

## Workbench Settings

`settings/` 拥有 Workbench preferences 的版本化文档、校验、原子持久化与进程内订阅。它只依赖
`@workbench/agent-runtime-contracts/settings` 中的通用协议，不导入任何具体 Agent Runtime SDK 或 wire
协议。默认文件目录与兼容环境变量由 `workbench/server/workbench-settings.ts` 这个应用组合点注入；当前
安装选择 Pi，因此该组合点才会读取 Pi agent 目录。Pi RPC route 只取得 `WorkbenchSettingsProtocol`，
不会反向依赖 Host 实现。

## Execution

`executions/` 是 Workbench 的执行能力。它负责 Workflow 定义校验与编译、运行准入与并发、节点调度、
审批、运行事件和持久化。Automation 是独立的定义、存储与调度领域；两者都不是某个 Agent Runtime
的能力。

Execution 核心通过 `ExecutionNodeExecutorRegistry` 接收节点执行器，不导入 Pi；Workbench 的 Command
节点执行器也在本目录。当前 Pi 集成只在 `packages/agent-runtime/adapters/pi/server/src/executions` 提供 Agent 节点适配、工作区/
会话事件接线及 RPC 组合。
共享 DTO 由 `@workbench/execution-contracts` 提供。为兼容已有客户端与本地数据，本次迁移继续读取
`workflow.*` RPC、`workbench-workflows/v1` 以及项目 `.pi/workflows`；新的根目录覆盖变量为
`WORKBENCH_EXECUTION_DIR`，旧 `PI_WORKBENCH_WORKFLOW_DIR` 仍可使用。

个人 Workflow 的草稿、Agent 工作目录、修订和 Run 保存在 `workbench-workflows/v1/workflows/<id>`；
项目 Workflow 的同一组数据保存在所选项目 `.pi/workflows/<id>`。项目中相邻的 `<id>.json` 只承载
已发布定义。Repository 会把旧版本错放在用户根目录的项目 Workflow 整体迁移到项目目录。

## Agent Runtime 端口

通用 Agent Runtime 服务端边界的权威源码位于 `@workbench/agent-runtime-server`，调用方直接使用该包
的显式 subpath；`runtime/server` 不再提供重复的 `agent-*.ts` 兼容入口。公共入口包含三个由现有
Workbench 行为验证的能力：

- `AgentExecutionPort`：必须实现提交和取消；队列、重新生成、恢复和分支选择是显式 optional subport；
- `AgentThreadStorePort`：必须实现线程摘要与创建、重命名、删除；搜索和 fork 是显式 optional subport；
- `AgentCommandCatalogPort`：按 thread/user/project target 读取 Composer 可执行的通用命令目录。

这些端口统一使用 `threadId`、`rootPath`、结构化 Prompt、共享 `WorkbenchAgentCommand` 和稳定错误码。
状态、分支、fork 点与 mutation 使用实现拥有的 opaque string token，Workbench 只负责把 token 原样回传。
Pi 的 `sessionId`、`cwd`、`PiQueuedPrompt`、`CommandView`、`AgentSession`、JSONL 以及 Pi 错误码都由
`@workbench/agent-runtime-pi-server` 或 Pi 自己的服务层适配。

`AgentThreadStorePort.capabilities` 是创建能力的权威声明。目前 Pi 支持调用方指定 thread ID，不支持
创建时选择 preset；`SessionRpcService` 不再通过一组零散布尔依赖猜测当前实现能力。

`WorkbenchAgentServerAdapter` 只组合当前已经验证的服务端能力。第二个 Runtime 出现前不增加实现
registry，也不把 Pi 的 canonical history/event、resume checkpoint、model context、WebSocket frame
或完整资源来源枚举提升为伪通用模型；这些协议的共同部分应由真实的第二个实现验证后再抽取。

`@workbench/agent-runtime-server/installation` 表达“应用已经选择了哪个服务端实现”，并从该 installation 创建一个
`WorkbenchAgentServerAdapter`。创建时会验证共享 descriptor ID 与 adapter ID 一致，避免浏览器和服务端
使用两个漂移的 Runtime 身份。它没有全局状态、实现集合、优先级或 fallback；当前 Pi session 组合根
只创建一个 Pi installation，仍由原 Pi adapter 构造默认 commands/execution/threads 端口。

## 契约测试

`@workbench/agent-runtime-testkit/server` 导出
`defineWorkbenchAgentServerAdapterContract()`，供每个具体 Agent Runtime 从自己的测试文件注册同一组
后端无关行为。required-base 契约始终验证：

- 稳定实现 ID，以及 commands/execution/threads 三个窄端口的必需方法面；
- thread/user/project 三种 Composer command target 只返回 `WorkbenchAgentCommand`；
- Prompt admission 和 cancel 使用通用 execution DTO；
- thread catalog、创建、重命名、删除和能力声明使用通用 thread DTO；
- 实现异常在跨出 adapter 前归一化为 `AgentCommandCatalogError`、`AgentExecutionError` 或
  `AgentThreadStoreError` 的稳定错误码。

optional expectations 再按实现声明验证 regenerate、resume、branch、queue mutation、搜索和 fork。
同一 testkit subpath 的 fixture 只实现 required base；Pi conformance harness 则使用真正的
`PiAgentExecutionAdapter` 与 `PiAgentThreadStoreAdapter` 覆盖完整 optional 能力。具体实现的测试直接从
`@workbench/agent-runtime-testkit/server` 导入契约和 fixture。
