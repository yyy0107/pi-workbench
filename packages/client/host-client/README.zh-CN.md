# @workbench/host-client

[English](README.md)

Runtime HTTP 与 WebSocket 传输载体。

`src/` 拥有能力实现、契约与装配；`lib/` 为内部辅助源码，包含 `lib/runtime-url.ts`。测试放在 `tests/`。能力和辅助源码保留 TS/TSX，既有构建工具维持原语言；两处源码目录均最多一级子目录。

公开引用入口：`@workbench/host-client`、`@workbench/host-client/runtime-fetch` 和 `@workbench/host-client/runtime-websocket`。通用 RPC 契约和 `callRpc` 位于 `@workbench/api/{contracts,client}`；本包负责 Runtime connection 传输载体。调用 `callRpc` 时注入 `resolveRuntimeFetch()` 或 `createRuntimeFetch(...)` 的结果，不依赖 Host RPC facade。

```ts
import { callRpc } from "@workbench/api/client";
import { resolveRuntimeFetch } from "@workbench/host-client/runtime-fetch";

const result = await callRpc<Payload, Result>("workspace.files.read", payload, {
  transport: resolveRuntimeFetch(),
});
```

```bash
pnpm --filter @workbench/host-client typecheck
pnpm --filter @workbench/host-client test
```

源码分工：src 承载本包能力与契约，lib 仅放实际使用的内部辅助，tests 为包根测试。实际消费者示例：`src/runtime-fetch.ts` 引用 `lib/runtime-url.ts`。实现保留 TS/TSX；既有构建工具保持原语言。
