# @workbench/host-artifact-policy

[中文](README.zh-CN.md)

Build artifact admission for source shape, native dependencies and resources. Existing CommonJS build tooling keeps its language.

`src/` owns the capability, contracts and composition. `lib/` contains consumed internal helpers: `lib/filesystem.cjs`. Tests live in `tests/`. Capability and helper code stays TypeScript/TSX; existing build tooling keeps its language. Both source directories allow at most one child directory.

Public imports: `@workbench/host-artifact-policy/source-shape`, `@workbench/host-artifact-policy/runtime-native`, `@workbench/host-artifact-policy/runtime-model-resources`, `@workbench/host-artifact-policy/runtime-admission`, `@workbench/host-artifact-policy/web-next-runtime-exception`, `@workbench/host-artifact-policy/filesystem`. Cross-package consumers use explicit exports and `workspace:*` dependencies.

```bash
pnpm --filter @workbench/host-artifact-policy typecheck
pnpm --filter @workbench/host-artifact-policy test
```

Source layout: src owns this capability and its contracts; lib contains consumed internal helpers; tests live at the package root. Example consumer: `src/filesystem.cjs` imports `lib/filesystem.cjs`. Capability and helper code remains TS/TSX; existing build tooling retains its language.
