# @workbench/local-host-server

[中文](README.zh-CN.md)

Local directories, pickers, application detection and open operations.

`src/` owns the capability, contracts and composition. `lib/` contains consumed internal helpers: `lib/process.ts`. Tests live in `tests/`. Capability and helper code stays TypeScript/TSX; existing build tooling keeps its language. Both source directories allow at most one child directory.

Public imports: `@workbench/local-host-server/directories`, `@workbench/local-host-server/picker`, `@workbench/local-host-server/applications`, `@workbench/local-host-server/service`, `@workbench/local-host-server/rpc`. Cross-package consumers use explicit exports and `workspace:*` dependencies.

```bash
pnpm --filter @workbench/local-host-server typecheck
pnpm --filter @workbench/local-host-server test
```

Source layout: src owns this capability and its contracts; lib contains consumed internal helpers; tests live at the package root. Example consumer: `src/local-apps/detector-linux.ts` imports `lib/process.ts`. Capability and helper code remains TS/TSX; existing build tooling retains its language.
