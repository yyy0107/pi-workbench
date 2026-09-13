# @workbench/runtime-contracts

[中文](README.zh-CN.md) · [Packages](../../README.md) · [Spec009](../../../specs/009-host-infrastructure-naming/plan.md)

Shared Runtime connection, host capability, process-control and artifact-format contracts. Browser clients, Node services and builders use the same definitions. This package has no production dependencies.

## Imports

```ts
import { defineRuntimeConnection } from "@workbench/runtime-contracts/runtime-connection";
import { parseRuntimeHostIdentity } from "@workbench/runtime-contracts/runtime-host-identity";
```

These examples show public imports; supply connections, handlers or artifact paths required by each entry when creating instances.

## Public entries

| Import                                                            | Responsibility                                         | Source                                                                                   |
| ----------------------------------------------------------------- | ------------------------------------------------------ | ---------------------------------------------------------------------------------------- |
| `@workbench/runtime-contracts`                                    | Root exports; see the source for its aggregation scope | [src/index.ts](./src/index.ts)                                                           |
| `@workbench/runtime-contracts/runtime-connection`                 | Connection descriptors and authentication frames       | [src/runtime-connection.ts](./src/runtime-connection.ts)                                 |
| `@workbench/runtime-contracts/runtime-capabilities`               | Host file, directory, application and trust DTOs       | [src/runtime-capabilities.ts](./src/runtime-capabilities.ts)                             |
| `@workbench/runtime-contracts/host-control`                       | Basic host ready/shutdown messages                     | [src/host-control.ts](./src/host-control.ts)                                             |
| `@workbench/runtime-contracts/runtime-connected-web-control`      | Connected Web/Runtime execution modes                  | [src/runtime-connected-web-control.ts](./src/runtime-connected-web-control.ts)           |
| `@workbench/runtime-contracts/control-ndjson`                     | Bounded control-frame codec                            | [src/control-ndjson.ts](./src/control-ndjson.ts)                                         |
| `@workbench/runtime-contracts/runtime-host-control`               | Runtime process-control protocol                       | [src/runtime-host-control.ts](./src/runtime-host-control.ts)                             |
| `@workbench/runtime-contracts/runtime-host-identity`              | Runtime identity protocol and parsing                  | [src/runtime-host-identity.ts](./src/runtime-host-identity.ts)                           |
| `@workbench/runtime-contracts/runtime-artifact-manifest`          | Runtime artifact format and validation                 | [src/runtime-artifact-manifest.ts](./src/runtime-artifact-manifest.ts)                   |
| `@workbench/runtime-contracts/web-host-control`                   | Web process-control protocol                           | [src/web-host-control.ts](./src/web-host-control.ts)                                     |
| `@workbench/runtime-contracts/web-artifact-manifest`              | Web artifact format and validation                     | [src/web-artifact-manifest.ts](./src/web-artifact-manifest.ts)                           |
| `@workbench/runtime-contracts/desktop-renderer-artifact-manifest` | Desktop Renderer artifact format and validation        | [src/desktop-renderer-artifact-manifest.ts](./src/desktop-renderer-artifact-manifest.ts) |

## Boundaries

Runtime here means the Workbench backend and its execution protocols. Agent sessions belong to agent-runtime-contracts, Pi protocols to pi-rpc-contracts, and generic RPC envelopes to api/contracts. Artifact formats use explicit subpaths; the root only aggregates connection, host capability and basic control definitions.

Related packages: [runtime-transport-client](../../transport/runtime-transport-client/README.md), [application-process](../../process/application-process/README.md), [artifact-reader](../../build/artifact-reader/README.md).

## Source navigation

- [src/runtime-connection.ts](src/runtime-connection.ts)
- [src/runtime-capabilities.ts](src/runtime-capabilities.ts)
- [src/runtime-host-control.ts](src/runtime-host-control.ts)
- [src/runtime-artifact-manifest.ts](src/runtime-artifact-manifest.ts)
- [lib/control-ndjson.ts](lib/control-ndjson.ts)

## Validation

```bash
pnpm --filter @workbench/runtime-contracts typecheck
pnpm --filter @workbench/runtime-contracts test
```

Package tests cover contracts, transport, process or build logic. This migration excludes UI rendering and interaction tests. See Spec009 for integration validation.
