# Workbench Server Runtime

`runtime/server` 保存 Workbench 自己拥有、只在宿主服务端运行的能力，以及后端无关的 Agent Runtime
端口。这里不放 React 状态、具体 Agent SDK 对象或实现专属事件模型。

## Execution

`executions/` 是 Workbench 的执行能力。它负责 Workflow 定义校验与编译、运行准入与并发、节点调度、
审批、运行事件和持久化。Automation 是独立的定义、存储与调度领域；两者都不是某个 Agent Runtime
的能力。

Execution 核心通过 `ExecutionNodeExecutorRegistry` 接收节点执行器，不导入 Pi；Workbench 的 Command
节点执行器也在本目录。当前 Pi 集成只在 `runtime/pi/server/executions` 提供 Agent 节点适配、工作区/
会话事件接线及 RPC 组合。
共享 DTO 位于 `runtime/shared/execution.ts`。为兼容已有客户端与本地数据，本次迁移继续读取
`workflow.*` RPC、`workbench-workflows/v1` 以及项目 `.pi/workflows`；新的根目录覆盖变量为
`WORKBENCH_EXECUTION_DIR`，旧 `PI_WORKBENCH_WORKFLOW_DIR` 仍可使用。

个人 Workflow 的草稿、Agent 工作目录、修订和 Run 保存在 `workbench-workflows/v1/workflows/<id>`；
项目 Workflow 的同一组数据保存在所选项目 `.pi/workflows/<id>`。项目中相邻的 `<id>.json` 只承载
已发布定义。Repository 会把旧版本错放在用户根目录的项目 Workflow 整体迁移到项目目录。

## Agent Runtime 端口

当前端口边界包含三个已经由现有 Workbench 行为验证的能力：

- `AgentExecutionPort`：提交、队列、取消、重新生成、恢复和分支选择；
- `AgentThreadStorePort`：线程摘要、全文搜索文档、创建、重命名、fork 和删除；
- `AgentCommandCatalogPort`：按 thread/user/project target 读取 Composer 可执行的通用命令目录。

这些端口统一使用 `threadId`、`rootPath`、结构化 Prompt、共享 `WorkbenchAgentCommand` 和稳定错误码。
Pi 的 `sessionId`、`cwd`、`PiQueuedPrompt`、`CommandView`、`AgentSession`、JSONL 以及 Pi 错误码都由
`runtime/pi/server/agent-runtime` 或 Pi 自己的服务层适配。

`AgentThreadStorePort.capabilities` 是创建能力的权威声明。目前 Pi 支持调用方指定 thread ID，不支持
创建时选择 preset；`SessionRpcService` 不再通过一组零散布尔依赖猜测当前实现能力。

`WorkbenchAgentServerAdapter` 只组合当前已经验证的服务端能力。第二个 Runtime 出现前不增加实现
registry，也不把 Pi 的 canonical history/event、resume checkpoint、model context、WebSocket frame
或完整资源来源枚举提升为伪通用模型；这些协议的共同部分应由真实的第二个实现验证后再抽取。

`agent-runtime-installation.ts` 表达“应用已经选择了哪个服务端实现”，并从该 installation 创建一个
`WorkbenchAgentServerAdapter`。创建时会验证共享 descriptor ID 与 adapter ID 一致，避免浏览器和服务端
使用两个漂移的 Runtime 身份。它没有全局状态、实现集合、优先级或 fallback；当前 Pi session 组合根
只创建一个 Pi installation，仍由原 Pi adapter 构造默认 commands/execution/threads 端口。

## 契约测试

`testing/agent-server-adapter-contract.ts` 导出
`defineWorkbenchAgentServerAdapterContract()`，供每个具体 Agent Runtime 从自己的测试文件注册同一组
后端无关行为：

- 稳定实现 ID，以及 commands/execution/threads 三个窄端口的完整方法面；
- thread/user/project 三种 Composer command target 只返回 `WorkbenchAgentCommand`；
- Prompt admission、regenerate、resume、branch、queue mutation 和 cancel 使用通用 execution DTO；
- thread catalog、搜索文档、创建、重命名、fork、删除和能力声明使用通用 thread DTO；
- 实现异常在跨出 adapter 前归一化为 `AgentCommandCatalogError`、`AgentExecutionError` 或
  `AgentThreadStoreError` 的稳定错误码。

`testing/fixture-agent-server-adapter.ts` 是验证套件自身的最小非 Pi fixture。Pi 的 conformance harness
仍使用真正的 `PiAgentExecutionAdapter` 与 `PiAgentThreadStoreAdapter`，只把底层 registry/host 调用替换为
测试依赖；它不会创建第二个 Pi service，也不会把 Pi DTO 提升到本目录。具体 SDK 参数映射、错误码映射和
持久化语义继续由实现目录内的专项测试负责。
