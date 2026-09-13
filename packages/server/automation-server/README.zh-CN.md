# @workbench/automation-server

[English](README.md)

自动化持久化、调度服务与 RPC。

`src/` 拥有能力实现、契约与装配；`lib/` 为内部辅助源码，包含 `lib/values.ts`。测试放在 `tests/`。能力和辅助源码保留 TS/TSX，既有构建工具维持原语言；两处源码目录均最多一级子目录。

公开引用入口：`@workbench/automation-server/errors`, `@workbench/automation-server/repository`, `@workbench/automation-server/service`, `@workbench/automation-server/rpc`。跨包只使用显式 exports 与 `workspace:*` 依赖；不跨包引用内部源码。

```bash
pnpm --filter @workbench/automation-server typecheck
pnpm --filter @workbench/automation-server test
```

源码分工：src 承载本包能力与契约，lib 仅放实际使用的内部辅助，tests 为包根测试。实际消费者示例：`src/repository.ts` 引用 `lib/values.ts`。实现保留 TS/TSX；既有构建工具保持原语言。
