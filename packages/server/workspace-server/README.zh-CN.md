# @workbench/workspace-server

[English](README.md)

工作区文件、Git、HTTP 与 RPC 服务。

`src/` 拥有能力实现、契约与装配；`lib/` 为内部辅助源码，包含 `lib/file-projection.ts`。测试放在 `tests/`。能力和辅助源码保留 TS/TSX，既有构建工具维持原语言；两处源码目录均最多一级子目录。

公开引用入口：`@workbench/workspace-server/local-files`, `@workbench/workspace-server/files`, `@workbench/workspace-server/git`, `@workbench/workspace-server/http`, `@workbench/workspace-server/rpc`。跨包只使用显式 exports 与 `workspace:*` 依赖；不跨包引用内部源码。

```bash
pnpm --filter @workbench/workspace-server typecheck
pnpm --filter @workbench/workspace-server test
```

源码分工：src 承载本包能力与契约，lib 仅放实际使用的内部辅助，tests 为包根测试。实际消费者示例：`src/local-files.ts` 引用 `lib/file-projection.ts`。实现保留 TS/TSX；既有构建工具保持原语言。

`./catalog` 拥有 WorkspaceStore 的项目归属、排序、固定/归档及持久化；`lib/catalog-state.ts` 提供实际复用的校验和投影。保存及本地订阅之后发出中立事件，Pi 宿主事件由 Pi 装配适配。原路径、settings section、跨进程锁与旧数据迁移保持；`dispose()` 解除通知，不回滚已提交写入。
