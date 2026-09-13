# @workbench/pi-rpc-client

[中文](README.zh-CN.md) · [Package navigation](../../README.md) · [Layer overview](../README.md)

Pi HTTP/RPC client operations and paired WebSocket connection management.

Execution environment: Browser-side transport (injectable for non-UI tests).

## Responsibilities

- Capture installation-scoped transport functions without binding runtime state to an application connection object.
- Manage mux/host socket generations, reconnects, readiness, watermarks and frame validation.
- Reuse the conversation adapter accumulator when materializing streamed messages.

## Imports

```ts
import { PiConnectionController, snapshotPiClientTransport } from "@workbench/pi-rpc-client";
```

These examples identify public imports. Supply the dependencies and options declared by the entry when constructing services or installing capabilities.

### Public entries and source

[package.json](package.json) `exports` is authoritative. This table lists all current public entries. Source links locate implementations; cross-package code imports the package entry on the left.

| Import path                            | Entry source                               |
| -------------------------------------- | ------------------------------------------ |
| `@workbench/pi-rpc-client`             | [src/index.ts](./src/index.ts)             |
| `@workbench/pi-rpc-client/api`         | [src/api.ts](./src/api.ts)                 |
| `@workbench/pi-rpc-client/connections` | [src/connections.ts](./src/connections.ts) |

## Source navigation

| Location                                                 | Purpose                             |
| -------------------------------------------------------- | ----------------------------------- |
| [src/api.ts](src/api.ts)                                 | Pi RPC operations and client errors |
| [src/client-transport.ts](src/client-transport.ts)       | Transport snapshot contract         |
| [src/connections.ts](src/connections.ts)                 | Paired socket lifecycle             |
| [lib/stream-frame-parser.ts](lib/stream-frame-parser.ts) | Stream frame parsing                |

## Boundaries and integration

Applications normally install pi-runtime-client or pi-workbench. Direct transport consumers must share one connection owner and dispose it with the installation.

Related owners:

- [@workbench/pi-runtime-client](../pi-runtime-client/README.md)
- [@workbench/pi-rpc-contracts](../pi-rpc-contracts/README.md)
- [@workbench/pi-conversation-adapter](../pi-conversation-adapter/README.md)
- [@workbench/api](../../transport/api/README.md)

## Maintenance and validation

```bash
pnpm --filter @workbench/pi-rpc-client typecheck
```

Keep implementation in `src/` and consumed internal helpers in `lib/`, preserving the current shallow TypeScript layout. Cross-package references use public exports and `workspace:*`. See the [validation record](../../../docs/package-layout-validation.md) for non-UI regression selection and build checks. Documentation-only edits require entry/path/format checks; UI/DOM/Hook tests and interactive smoke tests remain excluded for this refactor.
