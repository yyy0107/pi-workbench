# @workbench/workspace-server

[中文](README.zh-CN.md)

Workspace file, Git, HTTP and RPC services.

`src/` owns the capability, contracts and composition. `lib/` contains consumed internal helpers: `lib/file-projection.ts`. Tests live in `tests/`. Capability and helper code stays TypeScript/TSX; existing build tooling keeps its language. Both source directories allow at most one child directory.

Public imports: `@workbench/workspace-server/local-files`, `@workbench/workspace-server/files`, `@workbench/workspace-server/git`, `@workbench/workspace-server/http`, `@workbench/workspace-server/rpc`. Cross-package consumers use explicit exports and `workspace:*` dependencies.

```bash
pnpm --filter @workbench/workspace-server typecheck
pnpm --filter @workbench/workspace-server test
```

Source layout: src owns this capability and its contracts; lib contains consumed internal helpers; tests live at the package root. Example consumer: `src/local-files.ts` imports `lib/file-projection.ts`. Capability and helper code remains TS/TSX; existing build tooling retains its language.

`./catalog` owns WorkspaceStore directory membership, ordering, pin/archive state and persistence. `lib/catalog-state.ts` supplies consumed validation/projection helpers. It emits neutral events after persistence and local subscribers; Pi host event adaptation stays in Pi composition. Existing paths, settings section, cross-process locks and legacy migration remain unchanged. `dispose()` detaches notifications without rolling back already committed writes.
