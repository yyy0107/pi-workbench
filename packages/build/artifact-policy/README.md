# @workbench/artifact-policy

[中文](README.zh-CN.md) · [Packages](../../README.md) · [Spec009](../../../specs/009-host-infrastructure-naming/plan.md)

Artifact admission rules used by Workbench builds and launchers: source shape, Runtime native dependencies, model-readable resources and Next standalone dependency completion. Shared by Runtime, Web and Desktop builders and startup validation.

## Imports

```js
const {
  createRuntimeArtifactAdmissionPolicy,
} = require("@workbench/artifact-policy/runtime-admission");
const { isInside } = require("@workbench/artifact-policy/filesystem");
```

These examples show public imports; supply connections, handlers or artifact paths required by each entry when creating instances.

This package has no root entry; use the subpaths below.

## Public entries

| Import                                                  | Responsibility                                         | Source                                                                     |
| ------------------------------------------------------- | ------------------------------------------------------ | -------------------------------------------------------------------------- |
| `@workbench/artifact-policy/source-shape`               | Artifact source/test shape rules                       | [src/source-shape.cjs](./src/source-shape.cjs)                             |
| `@workbench/artifact-policy/runtime-native`             | Runtime native dependency inventories and target rules | [src/runtime-native.cjs](./src/runtime-native.cjs)                         |
| `@workbench/artifact-policy/runtime-model-resources`    | Model-readable resource boundary rules                 | [src/runtime-model-resources.cjs](./src/runtime-model-resources.cjs)       |
| `@workbench/artifact-policy/runtime-admission`          | Compose Runtime artifact admission policy              | [src/runtime-admission.cjs](./src/runtime-admission.cjs)                   |
| `@workbench/artifact-policy/web-next-runtime-exception` | Next standalone runtime dependency exceptions          | [src/web-next-runtime-exception.cjs](./src/web-next-runtime-exception.cjs) |
| `@workbench/artifact-policy/filesystem`                 | Filesystem and path helpers shared by builders         | [src/filesystem.cjs](./src/filesystem.cjs)                                 |

## Boundaries

An existing CommonJS build-tool package with CJS public entries. Some entries load TypeScript workspace contracts; callers retain the project’s tsx/cjs registration. Applications supply concrete Agent protocol paths to runtime-admission. artifact-reader performs validation and application-process owns process lifecycle. Built-in skills and Pi extension lists do not live here.

Related packages: [artifact-reader](../../build/artifact-reader/README.md), [runtime-contracts](../../contracts/runtime-contracts/README.md), [pi-workbench-runtime](../../product/pi-workbench-runtime/README.md).

## Source navigation

- [src/runtime-admission.cjs](src/runtime-admission.cjs)
- [src/runtime-native.cjs](src/runtime-native.cjs)
- [src/runtime-model-resources.cjs](src/runtime-model-resources.cjs)
- [src/source-shape.cjs](src/source-shape.cjs)
- [src/web-next-runtime-exception.cjs](src/web-next-runtime-exception.cjs)
- [lib/filesystem.cjs](lib/filesystem.cjs)

## Validation

```bash
pnpm --filter @workbench/artifact-policy test
```

Package tests cover contracts, transport, process or build logic. This migration excludes UI rendering and interaction tests. See Spec009 for integration validation.
