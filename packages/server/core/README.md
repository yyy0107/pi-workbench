# `@workbench/server-core`

Workbench 服务端进程复用的 Node-only 基础能力，不属于任何具体 Agent Runtime。

公开入口分别拥有子进程环境清理、跨进程文件锁与原子写入、Workbench 版本化 settings 文件、可安全投影的
RPC 领域错误、HTTP authority 信任判定/guard 和命名 shutdown hook。
包刻意不提供根 barrel，HTTP/WebSocket/Next 关闭编排仍属于应用 host，浏览器代码不能依赖本包。

本包不得依赖 Pi、Automation、Execution、Next.js、React 或应用目录。具体 Runtime 和应用组合根只能从列出的
公开 subpath 使用它，不能深导入 `src/**`。
