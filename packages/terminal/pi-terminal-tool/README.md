# @workbench/pi-terminal-tool

[中文](README.zh-CN.md)

Pi terminal tool adapters and command policy.

`src/` owns the capability, contracts and composition. `lib/` contains consumed internal helpers: `lib/command-options.ts`. Tests live in `tests/`. Capability and helper code stays TypeScript/TSX; existing build tooling keeps its language. Both source directories allow at most one child directory.

Public imports: `@workbench/pi-terminal-tool`. Cross-package consumers use explicit exports and `workspace:*` dependencies.

```bash
pnpm --filter @workbench/pi-terminal-tool typecheck
pnpm --filter @workbench/pi-terminal-tool test
```

Source layout: src owns this capability and its contracts; lib contains consumed internal helpers; tests live at the package root. Example consumer: `src/index.ts` imports `lib/command-options.ts`. Capability and helper code remains TS/TSX; existing build tooling retains its language.
