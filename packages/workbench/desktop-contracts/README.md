# @workbench/desktop-contracts

[中文](README.zh-CN.md)

Desktop bridge, title bar and Runtime bootstrap contracts.

`src/` owns the capability, contracts and composition. `lib/` contains consumed internal helpers: `lib/title-bar-validation.ts`. Tests live in `tests/`. Capability and helper code stays TypeScript/TSX; existing build tooling keeps its language. Both source directories allow at most one child directory.

Public imports: `@workbench/desktop-contracts`, `@workbench/desktop-contracts/title-bar`, `@workbench/desktop-contracts/runtime-bootstrap`. Cross-package consumers use explicit exports and `workspace:*` dependencies.

```bash
pnpm --filter @workbench/desktop-contracts typecheck
pnpm --filter @workbench/desktop-contracts test
```

Source layout: src owns this capability and its contracts; lib contains consumed internal helpers; tests live at the package root. Example consumer: `src/title-bar.ts` imports `lib/title-bar-validation.ts`. Capability and helper code remains TS/TSX; existing build tooling retains its language.
