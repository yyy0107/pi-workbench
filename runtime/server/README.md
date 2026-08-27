# Workbench Agent Server Ports

`runtime/server` 保存后端无关、但只在宿主服务端使用的 Agent Runtime 端口。这里不放浏览器协议、
React 状态、具体 Agent SDK 对象或实现专属事件模型。

当前边界只包含三个已经由现有 Workbench 行为验证的能力：

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
