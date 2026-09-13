# @workbench/browser-contracts

[中文](README.zh-CN.md)

Browser commands, permissions, events, settings and input validation.

`src/` owns the capability, contracts and composition. `lib/` contains consumed internal helpers: `lib/validation.ts`. Tests live in `tests/`. Capability and helper code stays TypeScript/TSX; existing build tooling keeps its language. Both source directories allow at most one child directory.

Public imports: `@workbench/browser-contracts`. Cross-package consumers use explicit exports and `workspace:*` dependencies.

```bash
pnpm --filter @workbench/browser-contracts typecheck
pnpm --filter @workbench/browser-contracts test
```

Source layout: src owns this capability and its contracts; lib contains consumed internal helpers; tests live at the package root. Example consumer: `src/index.ts` imports `lib/validation.ts`. Capability and helper code remains TS/TSX; existing build tooling retains its language.

The `./host` entry owns the implementation-neutral BrowserHost command port. Pi tools and host bindings import it without depending on browser-server or pi-browser.
