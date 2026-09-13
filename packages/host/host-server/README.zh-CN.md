# @workbench/host-server

[English](README.md)

HTTP、WebSocket、RPC 与 Runtime 宿主生命周期。

`src/` 拥有能力实现、契约与装配；`lib/` 为内部辅助源码，包含 `lib/runtime-transport-auth.ts`。测试放在 `tests/`。能力和辅助源码保留 TS/TSX，既有构建工具维持原语言；两处源码目录均最多一级子目录。

公开引用入口：`@workbench/host-server/runtime-transport-auth`, `@workbench/host-server/workbench-http-server`, `@workbench/host-server/fetch-request-handler`, `@workbench/host-server/api-only-runtime-host`, `@workbench/host-server/runtime-host-control-session`, `@workbench/host-server/web-host-control-session`, `@workbench/host-server/web-artifact`, `@workbench/host-server/runtime-artifact`, `@workbench/host-server/runtime-sidecar-proxy`, `@workbench/host-server/runtime-sidecar-child`, `@workbench/host-server/windows-process-census`, `@workbench/host-server/host-probe`, `@workbench/host-server/rpc`。跨包只使用显式 exports 与 `workspace:*` 依赖；不跨包引用内部源码。

```bash
pnpm --filter @workbench/host-server typecheck
pnpm --filter @workbench/host-server test
```

源码分工：src 承载本包能力与契约，lib 仅放实际使用的内部辅助，tests 为包根测试。实际消费者示例：`src/runtime-transport-auth.ts` 引用 `lib/runtime-transport-auth.ts`。实现保留 TS/TSX；既有构建工具保持原语言。
