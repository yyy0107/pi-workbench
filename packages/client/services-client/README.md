# @workbench/services-client

[中文](README.zh-CN.md)

Client APIs for settings, automation, host and workspace services.

These are optional domain facades over `@workbench/api/client`. They retain service-specific DTOs and error mapping while accepting/injecting the Runtime transport; generic callers should use `callRpc` from `@workbench/api/client` with an explicit `resolveRuntimeFetch()` or `createRuntimeFetch(...)` transport.

`src/` owns the capability, contracts and composition. `lib/` contains consumed internal helpers: `lib/file-text.ts`. Tests live in `tests/`. Capability and helper code stays TypeScript/TSX; existing build tooling keeps its language. Both source directories allow at most one child directory.

Public imports: `@workbench/services-client/settings`, `@workbench/services-client/automation`, `@workbench/services-client/host`, `@workbench/services-client/workspace`, `@workbench/services-client/errors`. Cross-package consumers use explicit exports and `workspace:*` dependencies.

```bash
pnpm --filter @workbench/services-client typecheck
pnpm --filter @workbench/services-client test
```

Source layout: src owns this capability and its contracts; lib contains consumed internal helpers; tests live at the package root. Example consumer: `src/file-content.ts` imports `lib/file-text.ts`. Capability and helper code remains TS/TSX; existing build tooling retains its language.
