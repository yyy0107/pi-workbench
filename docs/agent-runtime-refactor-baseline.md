# Agent Runtime Package Refactor Baseline

Recorded: 2026-08-29

Branch base: `46d72ae82a42a1d71443860f78e33a2bd31641a3` (`main`)

Implementation branch: `codex/agent-runtime-workspace-refactor`

Node: `v24.16.0`

pnpm: `11.22.0`

This baseline was recorded before workspace/package infrastructure changes. The working tree already
contained user changes in these Pi files (paths below reflect the current Runtime layout):

- `packages/agent-runtime/runtimes/pi/README.md`
- `packages/agent-runtime/runtimes/pi/server/src/streams/websocket-gateway.ts`
- `packages/agent-runtime/runtimes/pi/server/test/streams/websocket-gateway.test.ts`

Those changes are part of the observed baseline and must not be overwritten by the package migration.

## Verified completion result

The refactor completed on 2026-08-29 with 14 workspace leaf packages and the application still at
the repository root, as scoped by the plan. The original WebSocket backpressure/grace-period changes
were carried into the Pi Server package without replacing their implementation.

| Final gate                  | Result | Evidence                                                                                  |
| --------------------------- | ------ | ----------------------------------------------------------------------------------------- |
| `pnpm check`                | Pass   | Lint/format, manifest boundaries, root + 14 package typechecks, and all tests passed.     |
| `pnpm build`                | Pass   | Next 16.3.1 and the workspace-aware custom-server esbuild completed from fresh artifacts. |
| Electron staging/budget     | Pass   | 123.3 MiB, 6348 files, 115 dependency packages.                                           |
| Staged desktop server smoke | Pass   | Ready handshake, `host.describe`, `session.list`, and Pi WebSocket upgrade passed.        |
| Workspace source watch      | Pass   | Both web dev and Electron's direct `tsx watch` path restarted on package source changes.  |
| `pnpm electron:pack`        | Pass   | Linux unpacked directory passed the packaged-app budget at 123.2 MiB and 6339 files.      |
| Runtime payload cleanliness | Pass   | Zero TypeScript, tests, source maps, broken symlinks, and workspace-package externals.    |

The custom-server external allowlist remains exactly the same four third-party packages as the
baseline. Relative to the original staging measurement, the completed package architecture adds
approximately 2.2 MiB and 7 files while keeping the dependency-package count unchanged at 115.

Both original known failures were eliminated: the test loader resolves the supported Next ESM test
entry, and the Workbench Composer no longer imports the Pi implementation directly.

## Verification baseline

| Gate                       | Result                  | Evidence                                                                          |
| -------------------------- | ----------------------- | --------------------------------------------------------------------------------- |
| `pnpm typecheck`           | Pass                    | TypeScript exited with code 0.                                                    |
| `pnpm lint`                | Fail (pre-existing)     | `oxfmt --check` reports 74 formatting issues under `.agents/skills/**`.           |
| `pnpm test`                | Fail: 1710 pass, 2 fail | See the two known failures below.                                                 |
| `pnpm build`               | Pass                    | Next 16.3.1 production build and desktop custom-server esbuild completed.         |
| `pnpm electron:pack --dir` | Pass                    | Electron staged and packaged the Linux directory; packaged runtime budget passed. |

Known test failures before the refactor:

1. `runtime/assistant-ui/dependency-boundary.test.ts` reports
   `workbench/chat/workbench-composer.tsx` importing the Pi implementation. This is an existing
   architecture violation that the refactor plan explicitly removes.

## Desktop production baseline

- Custom-server external allowlist:
  - `@earendil-works/pi-coding-agent`
  - `next`
  - `node-pty`
  - `ws`
- Staged runtime: approximately `121.1 MiB`, `6341` files, `115` dependency packages.
- Packaged runtime: approximately `121.0 MiB`, `6332` files.
- Runtime budget: pass.
- The baseline runtime contains no forbidden TypeScript/test/source-map payload according to the
  existing budget check.

## Regression policy

- The two known test failures do not authorize new failures.
- The Composer/Pi dependency-boundary failure must be eliminated before the refactor is complete.
- The unrelated `.agents/skills/**` formatting baseline is not rewritten as part of this refactor;
  targeted formatting checks and source lint remain mandatory for files changed by the migration.
- Production comparisons must use fresh `.next`, `.desktop-build`, and Electron staging output.
