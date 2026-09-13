# @workbench/agent-runtime-contracts

[English](README.md)

跨运行时的 Agent 描述、命令、对话、附件与消息契约。

`src/` 拥有能力实现、契约与装配；`lib/` 为内部辅助源码，包含 `lib/metadata-values.ts`。测试放在 `tests/`。能力和辅助源码保留 TS/TSX，既有构建工具维持原语言；两处源码目录均最多一级子目录。

公开引用入口：`@workbench/agent-runtime-contracts`, `@workbench/agent-runtime-contracts/descriptor`, `@workbench/agent-runtime-contracts/commands`, `@workbench/agent-runtime-contracts/composer-attachments`, `@workbench/agent-runtime-contracts/conversation`, `@workbench/agent-runtime-contracts/message-metadata`, `@workbench/agent-runtime-contracts/runtime-capabilities`, `@workbench/agent-runtime-contracts/settings`。跨包只使用显式 exports 与 `workspace:*` 依赖；不跨包引用内部源码。

```bash
pnpm --filter @workbench/agent-runtime-contracts typecheck
pnpm --filter @workbench/agent-runtime-contracts test
```

源码分工：src 承载本包能力与契约，lib 仅放实际使用的内部辅助，tests 为包根测试。实际消费者示例：`src/message-metadata.ts` 引用 `lib/metadata-values.ts`。实现保留 TS/TSX；既有构建工具保持原语言。

`./workspace-catalog` 拥有中立工作区目录 DTO、事件及最小创建/关联/列举/移除端口；`./runtime-capabilities` 提供 WorkspaceFileReader。合同不依赖具体服务类或 Pi 协议。
