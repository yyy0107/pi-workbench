# @workbench/api

[English](README.md)

`@workbench/api` 负责 RPC 信封协议、公开错误品牌、校验器、客户端传输辅助函数和通用服务端请求处理。根入口和 `/contracts` 仅提供类型，且环境中立；`/errors`、`/validation` 和 `/client` 不依赖 Node、Host 或 Pi。`/server` 是仅服务端使用的入口，可以依赖 `server-core` 的 request-trust 原语。领域 DTO、业务 handler、Host connection/认证策略以及 Pi 集成仍归原有 owner 包负责。

使用以下显式子入口：

- `@workbench/api` 与 `@workbench/api/contracts`：请求/响应信封以及 issue/error 协议类型。
- `@workbench/api/errors`：`RpcDomainError`、`RpcBusinessError`、`rpcBusinessError` 与公开错误识别；不依赖 Node、Host 或 Pi。
- `@workbench/api/validation`：RPC 校验器和类型推导辅助类型。
- `@workbench/api/client`：`callRpc`、`RpcClientError`、`createRpcId` 和 `RpcTransport` 类型；`callRpc` 必须显式接收 transport。
- `@workbench/api/server`：`createRpcPostHandler`、`handleRpcPost`、route group dispatch、请求大小限制，以及 `readTrustedJsonPost` 和对应的 `TrustedJsonPostOptions`/`TrustedJsonPostResult` 类型。

浏览器或 Runtime 客户端应注入 `@workbench/host-client` 提供的传输载体：

```ts
import { callRpc } from "@workbench/api/client";
import { resolveRuntimeFetch } from "@workbench/host-client/runtime-fetch";

const value = await callRpc<Payload, Result>("workspace.files.read", payload, {
  transport: resolveRuntimeFetch(),
});
```

应用也可以传入 `@workbench/host-client/runtime-fetch` 的 `createRuntimeFetch(...)` 结果。`@workbench/services-client` 中的服务 facade 继续负责领域错误映射，并可为调用方注入 transport；它们是可选的领域便利层。

服务端组合根提供自己的业务 handler，并使用通用服务端入口：

```ts
import { createRpcPostHandler } from "@workbench/api/server";
import { rpcObject, rpcString } from "@workbench/api/validation";

const handler = createRpcPostHandler({
  method: "workspace.files.read",
  payload: rpcObject({ workspaceId: rpcString({ minLength: 1 }) }),
  handler: async ({ workspaceId }) => loadFile(workspaceId),
});
```

目录分工为：`src/` 放公开入口，`lib/` 放内部纯辅助代码，`tests/` 放契约测试。本包不包含业务 handler，也不得依赖 Host connection 状态、access token、Pi 或仅服务端可用的应用代码。服务端消费者仍按既有顺序执行 trust/authentication 与 body parse；`api/server` 只提供通用 handler 和 JSON POST 原语，不改变这些策略。

```bash
pnpm --filter @workbench/api typecheck
node --import ./scripts/register-typescript-test-loader.mjs --test \
  packages/transport/api/tests/{client,errors,validation,server,route-group}.test.ts
```
