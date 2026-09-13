# @workbench/artifact-reader

[中文](README.zh-CN.md) · [Packages](../../README.md) · [Spec009](../../../specs/009-host-infrastructure-naming/plan.md)

Reads and validates Runtime/Web artifacts in Node. Checks manifests, file inventories, hashes, path confinement, runtime targets and entrypoints for builders, launchers and release validation.

## Imports

```ts
import { resolveRuntimeArtifact } from "@workbench/artifact-reader/runtime-artifact";
import { resolveWebArtifact } from "@workbench/artifact-reader/web-artifact";
```

These examples show public imports; supply connections, handlers or artifact paths required by each entry when creating instances.

This package has no root entry; use the subpaths below.

## Public entries

| Import                                        | Responsibility                                            | Source                                               |
| --------------------------------------------- | --------------------------------------------------------- | ---------------------------------------------------- |
| `@workbench/artifact-reader/web-artifact`     | Web artifact reading and integrity validation             | [src/web-artifact.ts](./src/web-artifact.ts)         |
| `@workbench/artifact-reader/runtime-artifact` | Runtime artifact reading, target and integrity validation | [src/runtime-artifact.ts](./src/runtime-artifact.ts) |

## Boundaries

Its only production dependency is runtime-contracts. Owns artifact reading and integrity validation, not server/process startup or product native-dependency/resource selection. Applications obtain Runtime native/resource admission rules from artifact-policy and inject them. Web reading remains synchronous; Runtime reading remains asynchronous.

Related packages: [runtime-contracts](../../contracts/runtime-contracts/README.md), [artifact-policy](../../build/artifact-policy/README.md), [application-process](../../process/application-process/README.md).

## Source navigation

- [src/runtime-artifact.ts](src/runtime-artifact.ts)
- [src/web-artifact.ts](src/web-artifact.ts)
- [lib/artifact-path.ts](lib/artifact-path.ts)

## Validation

```bash
pnpm --filter @workbench/artifact-reader typecheck
pnpm --filter @workbench/artifact-reader test
```

Package tests cover contracts, transport, process or build logic. This migration excludes UI rendering and interaction tests. See Spec009 for integration validation.
