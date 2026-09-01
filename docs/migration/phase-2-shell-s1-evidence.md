# Phase 2 Workbench Shell S1 evidence

Generated: 2026-08-29

Baseline source revision: `77322072c64aa6a15d8ee8bf34927a91669db488`
(`refactor: split agent runtime into workspace packages`)

Branch: `codex/agent-runtime-workspace-refactor`

This document records the first Workbench Shell extraction gate for
[`workbench-apps-packages-tauri-migration-plan.md`](../workbench-apps-packages-tauri-migration-plan.md).
The working tree also contains the earlier Phase 0, Phase 1, Extension Platform, Host Server, and
Terminal extraction work; no commit or staging operation was performed for this gate.

## Delivered boundary

`@workbench/shell` is now a real source-first workspace leaf with five finite public subpaths:

- `@workbench/shell/layout`
- `@workbench/shell/right-workspace`
- `@workbench/shell/resize`
- `@workbench/shell/conversation-title`
- `@workbench/shell/hosts/statusbar`

The package owns the platform-independent RightWorkspace state/layout model, conversation sizing,
conversation-title truncation, browser resize mechanics, the statusbar Slot host, and a pure
`WorkbenchMain` frame. The old root implementations and their tests were physically removed after
all consumers moved to the package entries; no compatibility implementation or old-path re-export
remains.

The package deliberately does **not** own the Next-aware Main View adapter, RightWorkspace
controller/persistence, React provider/context, feedback/runtime hosts, Panels, Command Palette,
header/sidebar/actions, or the complete Workbench Shell assembly. The root composition remains:

```text
PanelLayout
  -> @workbench/shell WorkbenchMain
    -> root Next-aware MainViewHost
      -> route children
  -> @workbench/shell WorkbenchStatusbar
```

Extension Workspace authoring contracts remain owned exclusively by `@workbench/extension-sdk`.
The Shell public RightWorkspace entry exports only Shell-owned state, selectors, layout, a11y, and
resize policy; it does not form a second SDK authoring barrel.

## Boundary guards

The migration extended the existing mechanical gates rather than relying on directory convention:

- the transport guard now scans `packages/workbench/shell/src` and rejects root aliases, Next,
  Node production APIs, Pi, Electron, Tauri, product endpoints, and direct WebSocket construction;
- the extension boundary test scans both package-owned RightWorkspace primitives and the remaining
  root RightWorkspace hosts;
- the workspace dependency checker rejects package/app reads of root production source through
  root aliases, relative escapes, long import clauses, or repository-root filesystem paths;
- the ownership ledger classifies the root `workbench/shell/main-view-host.tsx` adapter as future
  `apps/web` source, while already-moved root files no longer retain stale ledger exceptions;
- the checked Phase 0 inventory was regenerated after the source move and still passes drift tests.

Independent review found and closed the following pre-gate issues: a second SDK authoring export,
an unused `WorkbenchMain.className` seam that could not preserve the old Tailwind merge semantics,
two workspace-to-root source-checker bypasses, and a stale `lib/resize-spring.ts` ownership rule.

## Fresh verification

All prior `.next`, `.desktop-build`, `.electron-build`, and `dist-electron` outputs were moved aside
before the production build. None of the results below reused the pre-migration Next or Electron
artifact.

| Gate                                   | Result | Evidence                                                                                                                                                                                                                                                                                                                               |
| -------------------------------------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm check`                           | Pass   | Repository formatting/lint, workspace and transport boundaries, root plus 25 package typechecks, and the complete root/package test graph passed. The Shell leaf passed `43/43`.                                                                                                                                                       |
| Fresh `pnpm build`                     | Pass   | Next 16.3.1 production compilation, TypeScript, static generation, and the custom desktop server build completed from empty output directories.                                                                                                                                                                                        |
| Shell Tailwind source scan             | Pass   | The package-only `@container/statusbar-right` sentinel produced `.\@container\/statusbar-right{container:statusbar-right/inline-size}` in fresh `.next/static` CSS. Source search found the sentinel only in `packages/workbench/shell/src/hosts/statusbar.tsx`; no broad `@source packages/**` exception was needed.                  |
| Custom-server closure                  | Pass   | The build retained the exact external whitelist `@earendil-works/pi-coding-agent`, `next`, `node-pty`, and `ws`; no `@workbench/*` package became a runtime external.                                                                                                                                                                  |
| Fresh Electron staging and dir package | Pass   | `node electron/build-package.cjs --dir` produced a staged app of `123.4 MiB`, `6351` files, and `115` dependency packages; the unpacked packaged app was `123.3 MiB` and `6342` files.                                                                                                                                                 |
| `pnpm electron:budget`                 | Pass   | Independent budget verification measured application `123.4 MiB`, `node_modules` `38.0 MiB`, `6351` files, and `115` dependency packages, with no TypeScript, tests, source maps, broken links, or build-only package leakage.                                                                                                         |
| Staged Host control smoke              | Pass   | The packaged Electron 43 executable ran the actual staged Runtime under `ELECTRON_RUN_AS_NODE=1`, emitted the exact version-1 IPC ready payload on a random loopback port, served successful `host.describe` and `session.list` RPCs, accepted a Pi `events.host` WebSocket open/close, and exited `0` after the IPC shutdown message. |
| `git diff --check`                     | Pass   | No whitespace errors were found after the package move, review fixes, generated inventory formatting, or evidence update.                                                                                                                                                                                                              |

Compared with the Phase 1 evidence, the dependency-package count and rounded staged/package sizes
are unchanged. The fresh stage and package each contain two fewer files (`6351` versus `6353`, and
`6342` versus `6344`). This is consistent with removing root-owned source/build artifacts while the
browser Shell source is compiled into Next output rather than copied as workspace TypeScript.

No Browser/E2E run was needed for this slice: the moved implementation is behavior-preserving pure
state/layout code, and the only package-source rendering uncertainty was the Tailwind scan, which the
fresh CSS artifact resolves directly.

## Residual Phase 2 gates

This evidence closes Shell S1 only. The following work remains explicit:

1. RightWorkspace controller persistence and catalog validation need injected, keyless ports before
   the controller/provider/context can move into the generic Shell package.
2. Panels, Command Palette, header/sidebar/actions, and the complete Shell assembly remain blocked on
   shared UI/i18n ownership and later app composition work.
3. Execution Server, Automation/Settings capability ownership, and the API-only Runtime Host/app
   assembly remain later Phase 2/Phase 3 work units.
4. Terminal package extraction has a separate native reproducibility P2: `tree-sitter` staging must
   normalize to one platform prebuild and record native file/ABI provenance. The fresh artifact above
   proves the current Electron path still works, but it does not close that aggregate Phase 2 native
   release gate or authorize removal of the root native compatibility declarations.
