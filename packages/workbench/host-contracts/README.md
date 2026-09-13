# @workbench/host-contracts

[中文](README.zh-CN.md)

Runtime capabilities, connections and host control protocols.

`src/` owns the capability, contracts and composition. `lib/` contains consumed internal helpers: `lib/control-ndjson.ts`. Tests live in `tests/`. Capability and helper code stays TypeScript/TSX; existing build tooling keeps its language. Both source directories allow at most one child directory.

Public imports: `@workbench/host-contracts`, `@workbench/host-contracts/runtime-connection`, `@workbench/host-contracts/runtime-capabilities`, `@workbench/host-contracts/host-control`, `@workbench/host-contracts/runtime-connected-web-control`, `@workbench/host-contracts/control-ndjson`, `@workbench/host-contracts/runtime-host-control`, `@workbench/host-contracts/runtime-host-identity`, `@workbench/host-contracts/runtime-artifact-manifest`, `@workbench/host-contracts/web-host-control`, `@workbench/host-contracts/web-artifact-manifest`, `@workbench/host-contracts/desktop-renderer-artifact-manifest`, `@workbench/host-contracts/rpc`. Cross-package consumers use explicit exports and `workspace:*` dependencies.

```bash
pnpm --filter @workbench/host-contracts typecheck
pnpm --filter @workbench/host-contracts test
```

Source layout: src owns this capability and its contracts; lib contains consumed internal helpers; tests live at the package root. Example consumer: `src/control-ndjson.ts` imports `lib/control-ndjson.ts`. Capability and helper code remains TS/TSX; existing build tooling retains its language.
