# Phase 2 Execution Server Evidence

Recorded: 2026-08-30

Baseline source revision: `77322072c64aa6a15d8ee8bf34927a91669db488`
(`refactor: split agent runtime into workspace packages`)

Branch: `codex/agent-runtime-workspace-refactor`

This document records the Phase 2 Execution capability extraction. The shared fresh production
artifact proof is recorded once in
[Phase 2 Aggregate Release Evidence](./phase-2-aggregate-release-evidence.md), rather than
duplicating package/staging measurements in every capability record.

## Delivered boundary

`@workbench/execution-server` is the complete Workbench-owned Execution server capability. It owns
Workflow definition validation and compilation, repository persistence, run admission and
scheduling, approvals, the execution engine/service, and the concrete Terminal Command adapter.

Its finite public surface is deliberately limited to `./errors`, `./node-executor`, `./engine`,
`./repository`, `./service`, and `./terminal-command-executor`. The Terminal adapter consumes the
public `@workbench/terminal-server` command policy and tool-session manager; it does not declare or
reach around Terminal native dependencies.

The package does not import a concrete Agent Runtime, Pi SDK/server, application composition,
Next.js, React, or UI extensions. Pi-owned Agent-node executors and resource catalog bindings are
installed at the application composition boundary through
`@workbench/agent-runtime-pi-server`.

`ExecutionService` and `ExecutionEngine` remain long-lived application-composition instances. The
leaf does not create a parallel repository, engine, registry, queue, or active-run singleton during
development rebinds.

## Source and consumer closure

| Concern                                                                       | Owning boundary                                                  | Explicit non-owner                                              |
| ----------------------------------------------------------------------------- | ---------------------------------------------------------------- | --------------------------------------------------------------- |
| Execution domain errors, compiler, repository, engine, service, node executor | `@workbench/execution-server`                                    | Pi Adapter, Next routes, UI extensions                          |
| Terminal command execution edge                                               | `@workbench/execution-server` through public Terminal Server API | Pi Terminal implementation details, native package declarations |
| Pi Agent executor and resource catalog installation                           | application/Pi Adapter composition                               | generic Execution Server                                        |
| Long-lived service lifecycle and coordinated shutdown                         | application lifecycle                                            | Execution leaf                                                  |

The old `runtime/server/executions` source owner has been removed. The leaf has a real manifest,
independent TypeScript configuration, finite exports, colocated tests, and no root `@/*` alias
dependency.

## Verification evidence

| Gate                                         | Result | Evidence                                                                                                                                                                             |
| -------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Execution focused implementation tests       | Pass   | `36/36` focused tests passed after the source/test/closure migration.                                                                                                                |
| Package/ownership boundary gates             | Pass   | The leaf and its consumers use only declared public workspace entries; generic Execution code has no Pi, application, Next, React, or UI-extension import.                           |
| Repository validation                        | Pass   | `pnpm check` completed with lint/format, workspace and transport guards, root plus 25 package typechecks, and the root/package test graph.                                           |
| Fresh production build and release artifacts | Pass   | See the shared fresh-build, staged runtime/native smoke, Electron dir package, and budget evidence in [Phase 2 Aggregate Release Evidence](./phase-2-aggregate-release-evidence.md). |

## Residuals carried forward

1. Coordinated Execution/Automation shutdown remains application-lifecycle work. This extraction
   deliberately does not alter the existing shutdown graph.
2. Automation and settings do not become implicit new packages as a side effect of this Execution
   boundary; each needs an independent owner and capability justification.
3. Root native compatibility declarations remain deployment inputs until Electron staging resolves
   and rebuilds the native packages from their leaf manifests in a dedicated cleanup gate.
4. Phase 3 must atomically transfer `server.ts`, Runtime API routes, and warmup ownership without
   creating a second Host, Pi session registry, stream hub, or shutdown graph.
