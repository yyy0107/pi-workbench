# @workbench/runtime-transport-client

[中文](README.zh-CN.md) · [Packages](../../README.md) · [Spec009](../../../specs/009-host-infrastructure-naming/plan.md)

Client HTTP and WebSocket carriers for Runtime connections. Resolves addresses, attaches authentication and performs the WebSocket authentication handshake using an injected RuntimeConnection. Supports browser consumers and injected test carriers.

## Imports

```ts
import { callRpc } from "@workbench/api/client";
import { createRuntimeFetch } from "@workbench/runtime-transport-client/runtime-fetch";
import { createRuntimeWebSocket } from "@workbench/runtime-transport-client/runtime-websocket";
```

These examples show public imports; supply connections, handlers or artifact paths required by each entry when creating instances.

## Public entries

| Import                                                  | Responsibility                                         | Source                                                 |
| ------------------------------------------------------- | ------------------------------------------------------ | ------------------------------------------------------ |
| `@workbench/runtime-transport-client`                   | Root exports; see the source for its aggregation scope | [src/index.ts](./src/index.ts)                         |
| `@workbench/runtime-transport-client/runtime-fetch`     | HTTP addresses, authentication and Fetch carrier       | [src/runtime-fetch.ts](./src/runtime-fetch.ts)         |
| `@workbench/runtime-transport-client/runtime-websocket` | WebSocket addresses and authentication handshake       | [src/runtime-websocket.ts](./src/runtime-websocket.ts) |

## Boundaries

Depends only on runtime-contracts. Shell/product code installs and owns the RuntimeConnection. Generic callRpc lives in api/client; domain clients live in services-client or pi-rpc-client. This package does not create Pi sessions, launch processes or implement domain reconnection policy.

Related packages: [runtime-contracts](../../contracts/runtime-contracts/README.md), [runtime-transport-server](../../transport/runtime-transport-server/README.md), [api](../../transport/api/README.md).

## Source navigation

- [src/runtime-fetch.ts](src/runtime-fetch.ts)
- [src/runtime-websocket.ts](src/runtime-websocket.ts)
- [lib/runtime-url.ts](lib/runtime-url.ts)

## Validation

```bash
pnpm --filter @workbench/runtime-transport-client typecheck
pnpm --filter @workbench/runtime-transport-client test
```

Package tests cover contracts, transport, process or build logic. This migration excludes UI rendering and interaction tests. See Spec009 for integration validation.
