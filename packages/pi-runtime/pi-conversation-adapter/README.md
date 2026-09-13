# @workbench/pi-conversation-adapter

[中文](README.zh-CN.md) · [Package navigation](../../README.md) · [Layer overview](../README.md)

Pi message/event parsing and projection into Workbench conversation data.

Execution environment: Shared deterministic data/contracts for client and server.

## Responsibilities

- Assemble canonical Pi messages into Workbench conversation snapshots and node/block projections.
- Share stream accumulation, usage/statistics, queue, timing and Trace projections.

## Imports

```ts
import { PiConversationAssembler } from "@workbench/pi-conversation-adapter/assembler";
import { SessionMessageAccumulator } from "@workbench/pi-conversation-adapter/accumulator";
```

These examples identify public imports. Supply the dependencies and options declared by the entry when constructing services or installing capabilities.

### Public entries and source

[package.json](package.json) `exports` is authoritative. This table lists all current public entries. Source links locate implementations; cross-package code imports the package entry on the left.

| Import path                                        | Entry source                                                                 |
| -------------------------------------------------- | ---------------------------------------------------------------------------- |
| `@workbench/pi-conversation-adapter`               | [src/index.ts](./src/index.ts)                                               |
| `@workbench/pi-conversation-adapter/assembler`     | [src/conversation-assembler.ts](./src/conversation-assembler.ts)             |
| `@workbench/pi-conversation-adapter/projection`    | [src/conversation-node-projection.ts](./src/conversation-node-projection.ts) |
| `@workbench/pi-conversation-adapter/model`         | [src/pi-conversation-message.ts](./src/pi-conversation-message.ts)           |
| `@workbench/pi-conversation-adapter/messages`      | [src/messages.ts](./src/messages.ts)                                         |
| `@workbench/pi-conversation-adapter/queue`         | [src/queue.ts](./src/queue.ts)                                               |
| `@workbench/pi-conversation-adapter/events`        | [src/events.ts](./src/events.ts)                                             |
| `@workbench/pi-conversation-adapter/live-tokens`   | [src/live-tokens.ts](./src/live-tokens.ts)                                   |
| `@workbench/pi-conversation-adapter/usage`         | [src/usage.ts](./src/usage.ts)                                               |
| `@workbench/pi-conversation-adapter/statistics`    | [src/statistics.ts](./src/statistics.ts)                                     |
| `@workbench/pi-conversation-adapter/timing`        | [src/timing.ts](./src/timing.ts)                                             |
| `@workbench/pi-conversation-adapter/context-trace` | [src/context-trace.ts](./src/context-trace.ts)                               |
| `@workbench/pi-conversation-adapter/rpc`           | [src/session-rpc-projection.ts](./src/session-rpc-projection.ts)             |
| `@workbench/pi-conversation-adapter/accumulator`   | [src/session-message-accumulator.ts](./src/session-message-accumulator.ts)   |

## Source navigation

| Location                                                                   | Purpose                        |
| -------------------------------------------------------------------------- | ------------------------------ |
| [src/conversation-assembler.ts](src/conversation-assembler.ts)             | Conversation snapshot assembly |
| [src/conversation-node-projection.ts](src/conversation-node-projection.ts) | Node and block projection      |
| [src/session-message-accumulator.ts](src/session-message-accumulator.ts)   | Streamed message accumulation  |
| [lib/live-token-meter.ts](lib/live-token-meter.ts)                         | Live token estimation helper   |

## Boundaries and integration

This package owns projection algorithms. Session state and network connection lifecycles remain with pi-runtime-client and pi-rpc-client.

Related owners:

- [@workbench/pi-runtime-client](../pi-runtime-client/README.md)
- [@workbench/pi-rpc-client](../pi-rpc-client/README.md)
- [@workbench/agent-runtime-contracts](../../agent-runtime/agent-runtime-contracts/README.md)

## Maintenance and validation

```bash
pnpm --filter @workbench/pi-conversation-adapter typecheck
```

Keep implementation in `src/` and consumed internal helpers in `lib/`, preserving the current shallow TypeScript layout. Cross-package references use public exports and `workspace:*`. See the [validation record](../../../docs/package-layout-validation.md) for non-UI regression selection and build checks. Documentation-only edits require entry/path/format checks; UI/DOM/Hook tests and interactive smoke tests remain excluded for this refactor.
