# @workbench/terminal-client

[中文](README.zh-CN.md)

Terminal WebSocket clients and connection URLs.

`src/` owns the capability, contracts and composition. `lib/` contains consumed internal helpers: `lib/terminal-socket-url.ts`. Tests live in `tests/`. Capability and helper code stays TypeScript/TSX; existing build tooling keeps its language. Both source directories allow at most one child directory.

Public imports: `@workbench/terminal-client`. Cross-package consumers use explicit exports and `workspace:*` dependencies.

```bash
pnpm --filter @workbench/terminal-client typecheck
pnpm --filter @workbench/terminal-client test
```

Source layout: src owns this capability and its contracts; lib contains consumed internal helpers; tests live at the package root. Example consumer: `src/index.ts` imports `lib/terminal-socket-url.ts`. Capability and helper code remains TS/TSX; existing build tooling retains its language.
