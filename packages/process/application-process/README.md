# @workbench/application-process

[中文](README.zh-CN.md) · [Packages](../../README.md) · [Spec009](../../../specs/009-host-infrastructure-naming/plan.md)

Lifecycle support for Workbench Runtime and Web service processes. Owns API-only Runtime startup, stdin/stdout control sessions, child launch and shutdown, readiness probes and Windows process-tree handling. Runs in Node or the Node environment used by the Electron main process.

## Imports

```ts
import { startRuntimeSidecar } from "@workbench/application-process/runtime-sidecar-child";
import { runRuntimeHostControlSession } from "@workbench/application-process/runtime-host-control-session";
import { startApiOnlyRuntimeHost } from "@workbench/application-process/api-only-runtime-host";
```

These examples show public imports; supply connections, handlers or artifact paths required by each entry when creating instances.

This package has no root entry; use the subpaths below.

## Public entries

| Import                                                        | Responsibility                                         | Source                                                                       |
| ------------------------------------------------------------- | ------------------------------------------------------ | ---------------------------------------------------------------------------- |
| `@workbench/application-process/api-only-runtime-host`        | API Runtime service startup and shutdown               | [src/api-only-runtime-host.ts](./src/api-only-runtime-host.ts)               |
| `@workbench/application-process/runtime-host-control-session` | Runtime control session and cleanup                    | [src/runtime-host-control-session.ts](./src/runtime-host-control-session.ts) |
| `@workbench/application-process/web-host-control-session`     | Web control session and cleanup                        | [src/web-host-control-session.ts](./src/web-host-control-session.ts)         |
| `@workbench/application-process/runtime-sidecar-child`        | Runtime child launch, streaming redaction and shutdown | [src/runtime-sidecar-child.ts](./src/runtime-sidecar-child.ts)               |
| `@workbench/application-process/windows-process-census`       | Windows process identity and tree cleanup (CJS)        | [src/windows-process-census.cjs](./src/windows-process-census.cjs)           |
| `@workbench/application-process/host-probe`                   | Service identity and readiness probing (CJS)           | [src/host-probe.cjs](./src/host-probe.cjs)                                   |

## Boundaries

Depends on runtime-contracts and runtime-transport-server. Applications choose executables, resolve and admit artifacts, assemble Pi/terminal/browser services, then inject startup and cleanup callbacks. Existing timeout, cancellation, authentication and cleanup semantics remain intact. extension-host separately manages extensions and UI mounting.

Related packages: [runtime-transport-server](../../transport/runtime-transport-server/README.md), [artifact-reader](../../build/artifact-reader/README.md), [extension-host](../../extension-platform/extension-host/README.md).

## Source navigation

- [src/runtime-sidecar-child.ts](src/runtime-sidecar-child.ts)
- [src/runtime-host-control-session.ts](src/runtime-host-control-session.ts)
- [src/web-host-control-session.ts](src/web-host-control-session.ts)
- [src/api-only-runtime-host.ts](src/api-only-runtime-host.ts)
- [src/host-probe.cjs](src/host-probe.cjs)
- [src/windows-process-census.cjs](src/windows-process-census.cjs)
- [lib/streaming-secret-redactor.ts](lib/streaming-secret-redactor.ts)

## Validation

```bash
pnpm --filter @workbench/application-process typecheck
pnpm --filter @workbench/application-process test
```

Package tests cover contracts, transport, process or build logic. This migration excludes UI rendering and interaction tests. See Spec009 for integration validation.
