# @workbench/services-client

[English](README.md)

设置、自动化、宿主和工作区服务的客户端 API。

`src/` 拥有能力实现、契约与装配；`lib/` 为内部辅助源码，包含 `lib/file-text.ts`。测试放在 `tests/`。能力和辅助源码保留 TS/TSX，既有构建工具维持原语言；两处源码目录均最多一级子目录。

公开引用入口：`@workbench/services-client/settings`, `@workbench/services-client/automation`, `@workbench/services-client/host`, `@workbench/services-client/workspace`, `@workbench/services-client/errors`。跨包只使用显式 exports 与 `workspace:*` 依赖；不跨包引用内部源码。

```bash
pnpm --filter @workbench/services-client typecheck
pnpm --filter @workbench/services-client test
```

源码分工：src 承载本包能力与契约，lib 仅放实际使用的内部辅助，tests 为包根测试。实际消费者示例：`src/file-content.ts` 引用 `lib/file-text.ts`。实现保留 TS/TSX；既有构建工具保持原语言。
