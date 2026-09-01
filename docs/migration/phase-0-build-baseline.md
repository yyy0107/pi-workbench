# Apps / Packages / Electron / Tauri Phase 0 Build Baseline

Recorded: 2026-08-29

Source revision: `77322072c64aa6a15d8ee8bf34927a91669db488`
(`refactor: split agent runtime into workspace packages`)

Branch: `codex/agent-runtime-workspace-refactor`

This is the pre-migration production baseline for
[`workbench-apps-packages-tauri-migration-plan.md`](../workbench-apps-packages-tauri-migration-plan.md).
At capture time the only source-worktree changes were the two migration-plan documents; production
code matched the source revision above. No `apps/*` or Tauri workspace existed.

## Environment

| Component        | Baseline                           |
| ---------------- | ---------------------------------- |
| Operating system | Linux `7.0.0-30-generic`, `x86_64` |
| Node.js          | `v24.16.0`                         |
| pnpm             | `11.22.0`                          |
| Next.js          | `16.3.1`                           |
| Electron         | `43.4.1`                           |

## Fresh-build procedure

The existing `.next`, `.desktop-build`, and `.electron-build` directories were moved out of the
repository before the first production build. The baseline therefore does not rely on output from
the completed Agent Runtime package migration. Electron packaging then rebuilt Web and custom-server
artifacts through the ordinary root command.

## Gate results

| Gate                             | Result | Evidence                                                                                                                                                              |
| -------------------------------- | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm check`                     | Pass   | Formatting/lint, workspace dependency boundary, root plus 14 package typechecks, and all root/package tests passed.                                                   |
| Fresh `pnpm build`               | Pass   | Next production build and the custom-server esbuild completed from empty build roots.                                                                                 |
| Next standalone shape            | Pass   | Current relative app directory is the repository root: `.next/standalone/server.js`, `.next/standalone/.next`, `packages`, `public`, and the traced runtime closure.  |
| Custom-server external allowlist | Pass   | Exactly `@earendil-works/pi-coding-agent`, `next`, `node-pty`, and `ws`; no `@workbench/*` external.                                                                  |
| Electron staging/runtime budget  | Pass   | `123.3 MiB`, `6348` files, `115` dependency packages.                                                                                                                 |
| Staged Host smoke                | Pass   | IPC ready on a random loopback port, `host.describe`, `session.list`, Pi `events.host` WebSocket upgrade, and IPC shutdown passed from the actual staged runtime cwd. |
| `pnpm electron:pack`             | Pass   | Linux unpacked directory was produced and the packaged-app budget passed at `123.2 MiB`, `6339` files.                                                                |
| Runtime cleanliness              | Pass   | Existing budget checks reported no TypeScript, tests, source maps, broken symlinks, build-only packages, or workspace-package runtime externals.                      |

The staged and packaged measurements exactly match the completed Agent Runtime delivery baseline, so
Phase 0 begins with no unexplained production-size, file-count, package-count, or external-allowlist
drift.

## Current root/path model

Before Phase 0 path vocabulary is introduced, the following concepts all resolve through the
repository root in one or more scripts:

- Web source/config: `app`, `public`, `next.config.ts`, and `.next`;
- combined Web + Runtime entry: `server.ts`;
- Runtime custom-server bundle: `.desktop-build/server.mjs`;
- Electron source and packaging: `electron` and `.electron-build`;
- packaged output: `dist-electron`.

The machine-audited ownership ledger and hard-coded path/native/dynamic-module inventory live in
[`phase-0-repository-inventory.json`](./phase-0-repository-inventory.json). Its evidence set is the
guard for later path and ownership changes; this build baseline is the human-readable record for
production output comparisons.

## Regression policy

- Phase 0 may rename internal path variables and add boundary checks, but it must not change the
  entrypoint, output layout, standalone relative app directory, external allowlist, runtime closure,
  RPC/WebSocket behavior, or packaging ownership.
- Later phases update an inventory entry only when the corresponding owner or coupling actually
  changes; snapshot regeneration is not a way to hide an unexplained dependency or path.
- Production comparisons use fresh Web, Runtime, and Electron staging outputs. A cached build cannot
  satisfy a migration gate.
- Platform-dependent size and native-file comparisons must record the platform, architecture, Node
  runtime, Electron version, and ABI owner before being compared with this Linux baseline.
