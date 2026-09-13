# @workbench/terminal-contracts

[中文](README.zh-CN.md)

Terminal frames, sessions and Bash tool input contracts.

`src/` owns the capability, contracts and composition. `lib/` contains consumed internal helpers: `lib/frame-validation.ts`. Tests live in `tests/`. Capability and helper code stays TypeScript/TSX; existing build tooling keeps its language. Both source directories allow at most one child directory.

Public imports: `@workbench/terminal-contracts`, `@workbench/terminal-contracts/bash-tool-input`. Cross-package consumers use explicit exports and `workspace:*` dependencies.

```bash
pnpm --filter @workbench/terminal-contracts typecheck
pnpm --filter @workbench/terminal-contracts test
```

Source layout: src owns this capability and its contracts; lib contains consumed internal helpers; tests live at the package root. Example consumer: `src/index.ts` imports `lib/frame-validation.ts`. Capability and helper code remains TS/TSX; existing build tooling retains its language.
