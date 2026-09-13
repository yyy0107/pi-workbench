# @workbench/pi-workbench

[中文](README.zh-CN.md)

Workbench and Pi application composition, product defaults and installation order.

`src/` owns the capability, contracts and composition. `lib/` contains consumed internal helpers: `lib/thinking-orb-renderer.tsx`. Tests live in `tests/`. Capability and helper code stays TypeScript/TSX; existing build tooling keeps its language. Both source directories allow at most one child directory.

Public imports: `@workbench/pi-workbench/application`, `@workbench/pi-workbench/installation`. Cross-package consumers use explicit exports and `workspace:*` dependencies.

```bash
pnpm --filter @workbench/pi-workbench typecheck
pnpm --filter @workbench/pi-workbench test
```

Source layout: src owns this capability and its contracts; lib contains consumed internal helpers; tests live at the package root. Example consumer: `src/running-indicator-defaults.tsx` imports `lib/thinking-orb-renderer.tsx`. Capability and helper code remains TS/TSX; existing build tooling retains its language.
