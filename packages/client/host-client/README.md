# @workbench/host-client

[中文](README.zh-CN.md)

Runtime HTTP and WebSocket transport carriers.

`src/` owns the capability, contracts and composition. `lib/` contains consumed internal helpers: `lib/runtime-url.ts`. Tests live in `tests/`. Capability and helper code stays TypeScript/TSX; existing build tooling keeps its language. Both source directories allow at most one child directory.

Public imports: `@workbench/host-client`, `@workbench/host-client/runtime-fetch`, and `@workbench/host-client/runtime-websocket`. Generic RPC contracts and `callRpc` live in `@workbench/api/{contracts,client}`; this package owns Runtime connection carriers. Inject `resolveRuntimeFetch()` or a `createRuntimeFetch(...)` result into `callRpc` instead of relying on a Host RPC facade.

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

Source layout: src owns this capability and its contracts; lib contains consumed internal helpers; tests live at the package root. Example consumer: `src/runtime-fetch.ts` imports `lib/runtime-url.ts`. Capability and helper code remains TS/TSX; existing build tooling retains its language.
