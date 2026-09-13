# @workbench/settings-server

[中文](README.zh-CN.md)

Settings persistence, updates and RPC.

`src/` owns the capability, contracts and composition. `lib/` contains consumed internal helpers: `lib/values.ts`. Tests live in `tests/`. Capability and helper code stays TypeScript/TSX; existing build tooling keeps its language. Both source directories allow at most one child directory.

Public imports: `@workbench/settings-server/file`, `@workbench/settings-server/service`, `@workbench/settings-server/rpc`. Cross-package consumers use explicit exports and `workspace:*` dependencies.

```bash
pnpm --filter @workbench/settings-server typecheck
pnpm --filter @workbench/settings-server test
```

Source layout: src owns this capability and its contracts; lib contains consumed internal helpers; tests live at the package root. Example consumer: `src/service.ts` imports `lib/values.ts`. Capability and helper code remains TS/TSX; existing build tooling retains its language.
