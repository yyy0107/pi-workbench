# @workbench/pi-sdk-sessions

[English](README.md)

Pi 会话注册、历史、附件、导入、自动化执行、用量和 Trace 领域服务。

进程级注册状态由运行中会话、持久会话目录、临时会话和 fork 串行化四个专门 owner 组成，并共同保留一个
跨 HMR 的状态图。registry facade 只协调行为，不创建第二套 SDK 会话、锁、缓存或清理生命周期。

`src/` 拥有能力实现、契约与装配；`lib/` 为内部辅助源码，包含 `lib/composer-conversation-context.ts`, `lib/composer-workspace-file-context.ts`, `lib/session-context-trace-summary.ts`, `lib/session-initial-model.ts`, `lib/session-queue.ts`, `lib/source-utils.ts`, `lib/system-prompt-placeholders.ts`, `lib/usage-statistics-aggregation.ts`。测试放在 `tests/`。能力和辅助源码保留 TS/TSX，既有构建工具维持原语言；两处源码目录均最多一级子目录。

公开引用入口：`@workbench/pi-sdk-sessions/cold-session-event-cache`, `@workbench/pi-sdk-sessions/composer-conversation-context`, `@workbench/pi-sdk-sessions/composer-workspace-file-context`, `@workbench/pi-sdk-sessions/inline-image-admission`, `@workbench/pi-sdk-sessions/interactive`, `@workbench/pi-sdk-sessions/scratch`, `@workbench/pi-sdk-sessions/context-trace`, `@workbench/pi-sdk-sessions/history`, `@workbench/pi-sdk-sessions/model-context`, `@workbench/pi-sdk-sessions/protocol`, `@workbench/pi-sdk-sessions/session-catalog-index`, `@workbench/pi-sdk-sessions/session-context-breakdown`, `@workbench/pi-sdk-sessions/session-context-policy`, `@workbench/pi-sdk-sessions/session-context-trace-journal`, `@workbench/pi-sdk-sessions/session-context-trace-summary`, `@workbench/pi-sdk-sessions/session-context-trace`, `@workbench/pi-sdk-sessions/session-event-journal`, `@workbench/pi-sdk-sessions/export`, `@workbench/pi-sdk-sessions/session-initial-model`, `@workbench/pi-sdk-sessions/session-interruption`, `@workbench/pi-sdk-sessions/session-queue`, `@workbench/pi-sdk-sessions/registry`, `@workbench/pi-sdk-sessions/session-resume`, `@workbench/pi-sdk-sessions/session-rpc-service`, `@workbench/pi-sdk-sessions/session-runtime-dependencies`, `@workbench/pi-sdk-sessions/system-prompt-placeholders`, `@workbench/pi-sdk-sessions/usage-statistics-aggregation`, `@workbench/pi-sdk-sessions/usage-statistics-store`, `@workbench/pi-sdk-sessions/usage`, `@workbench/pi-sdk-sessions/composer-text-attachments`, `@workbench/pi-sdk-sessions/claude-code-session-importer`, `@workbench/pi-sdk-sessions/codex-session-importer`, `@workbench/pi-sdk-sessions/cursor-session-importer`, `@workbench/pi-sdk-sessions/imports`, `@workbench/pi-sdk-sessions/external-session-types`, `@workbench/pi-sdk-sessions/source-utils`, `@workbench/pi-sdk-sessions/automation`, `@workbench/pi-sdk-sessions/execution`, `@workbench/pi-sdk-sessions/threads`。跨包只使用显式 exports 与 `workspace:*` 依赖；不跨包引用内部源码。

```bash
pnpm --filter @workbench/pi-sdk-sessions typecheck
pnpm --filter @workbench/pi-sdk-sessions test
```

源码分工：src 承载本包能力与契约，lib 仅放实际使用的内部辅助，tests 为包根测试。实际消费者示例：`src/composer-conversation-context.ts` 引用 `lib/composer-conversation-context.ts`。实现保留 TS/TSX；既有构建工具保持原语言。

Spec008 将 `hosted-pi-session.ts` 从注册表装配中分离：它仍是唯一 SDK 会话、事件和队列所有者，只接收发布、变化通知、交互响应、模型修订、Composer 命令、历史读取和文件读取等明确操作。`session-projections.ts` 为运行与冷历史读取共享原有历史/resume/元数据及消息投影规则，`session-types.ts` 保存包内合同。`hosted-session-lifecycle.ts`、`session-mutations.ts` 分别拥有销毁和单会话串行化；`persisted-session-directory.ts`、`scratch-session-directory.ts` 拥有目录更新及临时会话到期/文件清理。进程状态与 fork 串行化归 `session-registry-state.ts`，热更新接管保留原 Map、定时器、Promise 队列及旧闭包的标量更新。公开注册表方法与稳定协议 ID 保持不变。
