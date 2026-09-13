# @workbench/pi-runtime-terminal

[中文](README.zh-CN.md) · [Package navigation](../../README.md) · [Layer overview](../README.md)

Workbench Terminal integration for the Pi bash ToolDefinition.

Execution environment: Node.js / server.

## Responsibilities

- Create the Workbench-owned bash override with cwd, session identity and shell/command options.
- Reuse Terminal command policy, PTY execution, cancellation and agent/user stdin handling.

## Imports

```ts
import { createWorkbenchBashToolOverride } from "@workbench/pi-runtime-terminal";
```

These examples identify public imports. Supply the dependencies and options declared by the entry when constructing services or installing capabilities.

### Public entries and source

[package.json](package.json) `exports` is authoritative. This table lists all current public entries. Source links locate implementations; cross-package code imports the package entry on the left.

| Import path                      | Entry source                   |
| -------------------------------- | ------------------------------ |
| `@workbench/pi-runtime-terminal` | [src/index.ts](./src/index.ts) |

## Source navigation

| Location                                         | Purpose                               |
| ------------------------------------------------ | ------------------------------------- |
| [src/index.ts](src/index.ts)                     | Tool definition and execution adapter |
| [lib/command-options.ts](lib/command-options.ts) | Command and timeout normalization     |

## Boundaries and integration

PTY processes, native modules and terminal-session ownership remain in terminal-server. Host composition supplies this factory to Pi; preserve the stable bash tool name.

Related owners:

- [@workbench/terminal-server](../../terminal/terminal-server/README.md)
- [@workbench/terminal-contracts](../../terminal/terminal-contracts/README.md)
- [@workbench/pi-runtime-tools](../pi-runtime-tools/README.md)
- [@workbench/pi-runtime-server](../pi-runtime-server/README.md)

## Maintenance and validation

```bash
pnpm --filter @workbench/pi-runtime-terminal typecheck
```

Keep implementation in `src/` and consumed internal helpers in `lib/`, preserving the current shallow TypeScript layout. Cross-package references use public exports and `workspace:*`. See the [validation record](../../../docs/package-layout-validation.md) for non-UI regression selection and build checks. Documentation-only edits require entry/path/format checks; UI/DOM/Hook tests and interactive smoke tests remain excluded for this refactor.
