# @workbench/pi-runtime-server

[中文](README.zh-CN.md) · [Package navigation](../../README.md) · [Layer overview](../README.md)

Node-side composition of Pi SDK services and Workbench Runtime transport.

Execution environment: Node.js / server.

## Responsibilities

- Bind SDK session/model/resource services to Workbench Host collaborators and Agent server ports.
- Own ordered RPC route composition, HTTP handlers, stream publication and the no-server WebSocket gateway.
- Select Node product resources and extension defaults, then inject the existing collaborators into SDK services.

## Imports

```ts
import { createPiAgentServerImplementation } from "@workbench/pi-runtime-server/installation";
import { createPiRuntimeHttpRouter } from "@workbench/pi-runtime-server/http";
```

These examples identify public imports. Supply the dependencies and options declared by the entry when constructing services or installing capabilities.

This package has no root entry; select an explicit subpath from the table below.

### Public entries and source

[package.json](package.json) `exports` is authoritative. This table lists all current public entries. Source links locate implementations; cross-package code imports the package entry on the left.

| Import path                                 | Entry source                                               |
| ------------------------------------------- | ---------------------------------------------------------- |
| `@workbench/pi-runtime-server/installation` | [src/public/installation.ts](./src/public/installation.ts) |
| `@workbench/pi-runtime-server/http`         | [src/public/http.ts](./src/public/http.ts)                 |
| `@workbench/pi-runtime-server/websocket`    | [src/public/websocket.ts](./src/public/websocket.ts)       |
| `@workbench/pi-runtime-server/legacy`       | [src/public/legacy.ts](./src/public/legacy.ts)             |

## Source navigation

| Location                                                                         | Purpose                                  |
| -------------------------------------------------------------------------------- | ---------------------------------------- |
| [src/public/installation.ts](src/public/installation.ts)                         | Application-facing installation contract |
| [src/resource-composition.ts](src/resource-composition.ts)                       | Resource service composition             |
| [src/session-composition/registry.ts](src/session-composition/registry.ts)       | Registry selection and binding           |
| [src/tool-composition.ts](src/tool-composition.ts)                               | Product factories plus Host dependencies |
| [src/transport/rpc-route-composition.ts](src/transport/rpc-route-composition.ts) | RPC route composition                    |
| [lib/compaction-rpc-validator.ts](lib/compaction-rpc-validator.ts)               | Compaction request validation            |

## Boundaries and integration

SDK packages own actual session, model and resource services. This package composes them; the Runtime app owns external Host ingress, trust/authentication and process startup.

The legacy entry supports existing compatibility routes. New consumers should choose installation, http or websocket according to their responsibility.

Related owners:

- [@workbench/pi-sdk-sessions](../../pi-sdk/pi-sdk-sessions/README.md)
- [@workbench/pi-sdk-resources](../../pi-sdk/pi-sdk-resources/README.md)
- [@workbench/pi-sdk-models](../../pi-sdk/pi-sdk-models/README.md)
- [@workbench/pi-workbench-runtime](../../product/pi-workbench-runtime/README.md)
- [@workbench/agent-runtime-server](../../agent-runtime/agent-runtime-server/README.md)

## Maintenance and validation

```bash
pnpm --filter @workbench/pi-runtime-server typecheck
```

Keep implementation in `src/` and consumed internal helpers in `lib/`, preserving the current shallow TypeScript layout. Cross-package references use public exports and `workspace:*`. See the [validation record](../../../docs/package-layout-validation.md) for non-UI regression selection and build checks. Documentation-only edits require entry/path/format checks; UI/DOM/Hook tests and interactive smoke tests remain excluded for this refactor.
