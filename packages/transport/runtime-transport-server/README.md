# @workbench/runtime-transport-server

[中文](README.zh-CN.md) · [Packages](../../README.md) · [Spec009](../../../specs/009-host-infrastructure-naming/plan.md)

Node HTTP/WebSocket ingress for Runtime services: HTTP server, Fetch-to-Node request adaptation, connection authentication and a proxy to the Runtime child. Applications inject business handlers and WebSocket gateways.

## Imports

```ts
import { createWorkbenchHttpServer } from "@workbench/runtime-transport-server/workbench-http-server";
import { createFetchRequestHandler } from "@workbench/runtime-transport-server/fetch-request-handler";
import { createRuntimeSidecarProxy } from "@workbench/runtime-transport-server/runtime-sidecar-proxy";
```

These examples show public imports; supply connections, handlers or artifact paths required by each entry when creating instances.

This package has no root entry; use the subpaths below.

## Public entries

| Import                                                       | Responsibility                                            | Source                                                           |
| ------------------------------------------------------------ | --------------------------------------------------------- | ---------------------------------------------------------------- |
| `@workbench/runtime-transport-server/runtime-transport-auth` | Connection authentication, Origin and carrier constraints | [src/runtime-transport-auth.ts](./src/runtime-transport-auth.ts) |
| `@workbench/runtime-transport-server/workbench-http-server`  | HTTP server and WebSocket upgrade dispatch                | [src/workbench-http-server.ts](./src/workbench-http-server.ts)   |
| `@workbench/runtime-transport-server/fetch-request-handler`  | Node HTTP / Fetch Request/Response adaptation             | [src/fetch-request-handler.ts](./src/fetch-request-handler.ts)   |
| `@workbench/runtime-transport-server/runtime-sidecar-proxy`  | HTTP/WebSocket proxy to Runtime                           | [src/runtime-sidecar-proxy.ts](./src/runtime-sidecar-proxy.ts)   |

## Boundaries

Depends only on runtime-contracts and server-core. Owns neither Runtime child processes, the Pi service graph nor artifact reading. Authentication completes before business gateway allocation. The proxy forwards and closes connections; application-process owns child startup and ready/shutdown control sessions. Generic RPC dispatch uses api/server.

Related packages: [runtime-transport-client](../../transport/runtime-transport-client/README.md), [application-process](../../process/application-process/README.md), [runtime-contracts](../../contracts/runtime-contracts/README.md).

## Source navigation

- [src/workbench-http-server.ts](src/workbench-http-server.ts)
- [src/fetch-request-handler.ts](src/fetch-request-handler.ts)
- [src/runtime-sidecar-proxy.ts](src/runtime-sidecar-proxy.ts)
- [lib/runtime-transport-auth.ts](lib/runtime-transport-auth.ts)

## Validation

```bash
pnpm --filter @workbench/runtime-transport-server typecheck
pnpm --filter @workbench/runtime-transport-server test
```

Package tests cover contracts, transport, process or build logic. This migration excludes UI rendering and interaction tests. See Spec009 for integration validation.
