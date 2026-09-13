# @workbench/extension-sdk

[中文](README.zh-CN.md)

Extension authoring contracts, registries and contribution points.

`src/` owns the capability, contracts and composition. `lib/` contains consumed internal helpers: `lib/registry-utils.ts`. Tests live in `tests/`. Capability and helper code stays TypeScript/TSX; existing build tooling keeps its language. Both source directories allow at most one child directory.

Public imports: `@workbench/extension-sdk`, `@workbench/extension-sdk/authoring`, `@workbench/extension-sdk/internal`. Cross-package consumers use explicit exports and `workspace:*` dependencies.

```bash
pnpm --filter @workbench/extension-sdk typecheck
pnpm --filter @workbench/extension-sdk test
```

Source layout: src owns this capability and its contracts; lib contains consumed internal helpers; tests live at the package root. Example consumer: `src/registries/command-registry.ts` imports `lib/registry-utils.ts`. Capability and helper code remains TS/TSX; existing build tooling retains its language.

The `@workbench/extension-sdk/workspace-surfaces` entry exposes existing workspace surface constants and types without evaluating React authoring helpers. Headless controllers use this entry for runtime constants; contribution authors retain the normal root API.
