# @workbench/api

[中文](README.zh-CN.md)

`@workbench/api` owns the RPC wire envelope, public error brands, validators, client transport helpers, and generic server request handling. The root entry and `/contracts` are type-only and environment-neutral; `/errors`, `/validation`, and `/client` remain free of Node, Host, and Pi dependencies. `/server` is the server-only entry and may depend on `server-core` request-trust primitives. Domain DTOs, business handlers, Host connection/authentication policy, and Pi integration remain with their existing owner packages.

Use the explicit subpaths:

- `@workbench/api` and `@workbench/api/contracts` expose request/response envelopes and issue/error protocol types.
- `@workbench/api/errors` exposes `RpcDomainError`, `RpcBusinessError`, `rpcBusinessError`, and public error recognition. It has no Node, Host, or Pi dependency.
- `@workbench/api/validation` exposes the RPC validators and type inference helpers.
- `@workbench/api/client` exposes `callRpc`, `RpcClientError`, `createRpcId`, and the `RpcTransport` type. `callRpc` requires an explicit transport.
- `@workbench/api/server` exposes `createRpcPostHandler`, `handleRpcPost`, route-group dispatch, request limits, and `readTrustedJsonPost` with its `TrustedJsonPostOptions`/`TrustedJsonPostResult` types.

For a browser or Runtime client, inject the carrier owned by `@workbench/host-client`:

```ts
import { callRpc } from "@workbench/api/client";
import { resolveRuntimeFetch } from "@workbench/host-client/runtime-fetch";

const value = await callRpc<Payload, Result>("workspace.files.read", payload, {
  transport: resolveRuntimeFetch(),
});
```

An application may instead pass a `createRuntimeFetch(...)` result from `@workbench/host-client/runtime-fetch`. Service facades in `@workbench/services-client` keep their domain-specific error mapping and may provide that transport injection for callers; they remain optional domain conveniences.

A server composition root supplies its own business handler and uses the generic server entry:

```ts
import { createRpcPostHandler } from "@workbench/api/server";
import { rpcObject, rpcString } from "@workbench/api/validation";

const handler = createRpcPostHandler({
  method: "workspace.files.read",
  payload: rpcObject({ workspaceId: rpcString({ minLength: 1 }) }),
  handler: async ({ workspaceId }) => loadFile(workspaceId),
});
```

The package is organized as `src/` public entries, `lib/` internal pure helpers, and `tests/` contract tests. It has no business handlers and must not depend on Host connection state, access tokens, Pi, or server-only application code. Server consumers still perform trust/authentication and body parsing in the established order; `api/server` supplies the generic handler and JSON POST primitive without changing that policy.

```bash
pnpm --filter @workbench/api typecheck
node --import ./scripts/register-typescript-test-loader.mjs --test \
  packages/transport/api/tests/{client,errors,validation,server,route-group}.test.ts
```
