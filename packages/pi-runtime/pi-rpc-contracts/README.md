# @workbench/pi-rpc-contracts

[中文](README.zh-CN.md) · [Package navigation](../../README.md) · [Layer overview](../README.md)

Serializable Pi Runtime contracts shared across the client/server boundary.

Execution environment: Shared deterministic data/contracts for client and server.

## Responsibilities

- Define attachment metadata, Pi messages, RPC payloads and stream envelopes.
- Provide stream payload guards and validation helpers used at the transport boundary.

## Imports

```ts
import type { SessionEventPayload } from "@workbench/pi-rpc-contracts/stream";
import { STREAM_PATHS } from "@workbench/pi-rpc-contracts/stream";
```

These examples identify public imports. Supply the dependencies and options declared by the entry when constructing services or installing capabilities.

This package has no root entry; select an explicit subpath from the table below.

### Public entries and source

[package.json](package.json) `exports` is authoritative. This table lists all current public entries. Source links locate implementations; cross-package code imports the package entry on the left.

| Import path                               | Entry source                               |
| ----------------------------------------- | ------------------------------------------ |
| `@workbench/pi-rpc-contracts/attachments` | [src/attachments.ts](./src/attachments.ts) |
| `@workbench/pi-rpc-contracts/messages`    | [src/messages.ts](./src/messages.ts)       |
| `@workbench/pi-rpc-contracts/rpc`         | [src/rpc.ts](./src/rpc.ts)                 |
| `@workbench/pi-rpc-contracts/stream`      | [src/stream.ts](./src/stream.ts)           |

## Source navigation

| Location                                             | Purpose                   |
| ---------------------------------------------------- | ------------------------- |
| [src/rpc.ts](src/rpc.ts)                             | Request/response payloads |
| [src/stream.ts](src/stream.ts)                       | Stream frames and guards  |
| [src/messages.ts](src/messages.ts)                   | Pi message contracts      |
| [lib/stream-validation.ts](lib/stream-validation.ts) | Validation helpers        |

## Boundaries and integration

Wire contracts carry JSON-safe data. Keep SDK session objects, callbacks, credential stores, filesystem handles and React state out of serialized payloads.

Related owners:

- [@workbench/pi-rpc-client](../pi-rpc-client/README.md)
- [@workbench/pi-runtime-server](../pi-runtime-server/README.md)
- [@workbench/pi-sdk-ports](../../pi-sdk/pi-sdk-ports/README.md)

## Maintenance and validation

```bash
pnpm --filter @workbench/pi-rpc-contracts typecheck
```

Keep implementation in `src/` and consumed internal helpers in `lib/`, preserving the current shallow TypeScript layout. Cross-package references use public exports and `workspace:*`. See the [validation record](../../../docs/package-layout-validation.md) for non-UI regression selection and build checks. Documentation-only edits require entry/path/format checks; UI/DOM/Hook tests and interactive smoke tests remain excluded for this refactor.
