# Phase 2 Aggregate Release Evidence

Recorded: 2026-08-30

Baseline source revision: `77322072c64aa6a15d8ee8bf34927a91669db488`
(`refactor: split agent runtime into workspace packages`)

Branch: `codex/agent-runtime-workspace-refactor`

This document closes the Phase 2 aggregate release gate for the completed Extension Platform, Host
Server, Terminal, Execution Server, and Workbench Shell capability slices. It does not mark Phase 3
Runtime Host separation, `apps/*` relocation, Electron process split, static desktop renderer, or
Tauri work complete.

## Capability evidence map

| Capability slice   | Source-boundary evidence                                                           | Fresh shared artifact proof |
| ------------------ | ---------------------------------------------------------------------------------- | --------------------------- |
| Extension Platform | Phase 2 plan/status and package boundary suites                                    | This document               |
| Host Server        | Phase 2 plan/status and Host/transport suites                                      | This document               |
| Terminal           | [`packages/terminal/README.md`](../../packages/terminal/README.md) and leaf suites | This document               |
| Execution Server   | [Phase 2 Execution Server Evidence](./phase-2-execution-server-evidence.md)        | This document               |
| Shell S1           | [Phase 2 Workbench Shell S1 Evidence](./phase-2-shell-s1-evidence.md)              | This document               |
| Shell S2/S3        | [Phase 2 Workbench Shell S2/S3 Evidence](./phase-2-shell-s2-s3-evidence.md)        | This document               |

## Fresh-output procedure

Before the production build, the previous output roots were moved—not deleted—to the recoverable
directory `/home/wy/projects/workbench-aui/phase2-aggregate-artifacts.Z9BnrE`:

| Previous output   | Previous apparent size |
| ----------------- | ---------------------: |
| `.next`           |                540 MiB |
| `.desktop-build`  |                120 KiB |
| `.electron-build` |                146 MiB |
| `dist-electron`   |                413 MiB |

All four roots were absent before the fresh build. The backup directory remains available for
comparison/recovery and was not used as an input to the gates below.

## Environment and native target

| Field                    | Value                                         |
| ------------------------ | --------------------------------------------- |
| Operating system         | Linux `7.0.0-30-generic`, `x86_64`, GNU/Linux |
| Runtime target           | Linux `x64`, `glibc` `2.43`                   |
| Node.js                  | `v24.16.0`                                    |
| pnpm                     | `11.22.0`                                     |
| Electron                 | `43.4.1`                                      |
| Electron Node module ABI | `148`                                         |
| N-API                    | `10`                                          |
| Next.js                  | `16.3.1`                                      |

This is a real Linux target package and smoke. Other platform target policies and fixture tests are
not a substitute for macOS or Windows package/native verification.

## Aggregate gate results

| Gate                                                 | Result | Evidence                                                                                                                                                                                                                                                                                                                                        |
| ---------------------------------------------------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Repository validation                                | Pass   | `pnpm check` exited `0`: lint/format, workspace and transport guards, root plus 25 package typechecks, and the complete root/package test graph.                                                                                                                                                                                                |
| Fresh production build                               | Pass   | `pnpm build` exited `0`; Next `16.3.1` built 13 routes and the custom desktop server build completed.                                                                                                                                                                                                                                           |
| Custom-server closure                                | Pass   | Exact runtime externals are `@earendil-works/pi-coding-agent`, `next`, `node-pty`, and `ws`; no `@workbench/*` package is external. The fresh build recorded `2120` custom-server files, dynamic packages `@earendil-works/pi-ai` and `@earendil-works/pi-coding-agent`, and native packages `node-pty`, `tree-sitter`, and `tree-sitter-bash`. |
| Fresh staging, native/runtime smoke, and dir package | Pass   | `node electron/build-package.cjs --dir` exited `0`. It prepared the stage, ran the staged Electron native smoke, ran the staged Runtime Host smoke, produced the Linux unpacked directory, and enforced its packaged budget.                                                                                                                    |
| Independent staged budget                            | Pass   | `pnpm electron:budget` exited `0`.                                                                                                                                                                                                                                                                                                              |
| Package-only Tailwind source scan                    | Pass   | The only source occurrence is `packages/workbench/shell/src/hosts/statusbar.tsx:14`; fresh `.next/static/chunks/3j09g36895brz.css` contains `.\@container\/statusbar-right{container:statusbar-right/inline-size}`.                                                                                                                             |
| Whitespace                                           | Pass   | `git diff --check` found no whitespace errors.                                                                                                                                                                                                                                                                                                  |

No distribution installer is asserted here: the Electron invocation used `--dir`.

## Fresh artifact measurements and cleanliness

| Artifact                        |       Bytes |  Files | Dependency packages | Cleanliness                                                                     |
| ------------------------------- | ----------: | -----: | ------------------: | ------------------------------------------------------------------------------- |
| Staged desktop runtime          | `128592592` | `6343` |               `115` | 0 source maps, TypeScript source files, test/fixture files, and broken symlinks |
| Staged runtime `node_modules`   |  `39051214` |      — |      included above | included above                                                                  |
| Packaged runtime                | `128514484` | `6338` |               `115` | 0 source maps, TypeScript source files, test/fixture files, and broken symlinks |
| Packaged runtime `node_modules` |  `38973106` |      — |      included above | included above                                                                  |
| Fresh `.next`                   | `549579873` | `5049` |                   — | fresh output root                                                               |
| Fresh `.desktop-build`          |    `111379` |    `2` |                   — | fresh output root                                                               |
| Fresh `.electron-build`         | `128604327` | `6556` |                   — | fresh output root                                                               |
| Fresh `dist-electron`           | `408901759` | `6572` |                   — | fresh output root                                                               |
| Linux unpacked application      | `408900290` | `6571` |                   — | produced by `--dir`                                                             |

The budget additionally enforces no forbidden build-only package, no undeclared workspace-source
runtime package, and no `@workbench/*` runtime external. Size/file-count changes relative to earlier
Phase 0, Phase 1, and S1 snapshots are recorded here as a new fresh aggregate rather than changing
those historical measurements.

## Native provenance and actual load proof

The fresh staged `native-runtime-inventory.json` has schema version 1 and records the exact target
above. Every listed package names `@workbench/terminal-server` as its source owner. The staged
Electron native smoke loaded exactly the inventory's selected real paths.

| Package            | Version  | Selected binary                                                           | Role                   |      Size | SHA-256                                                            |
| ------------------ | -------- | ------------------------------------------------------------------------- | ---------------------- | --------: | ------------------------------------------------------------------ |
| `node-pty`         | `1.1.0`  | `node_modules/node-pty/build/Release/pty.node`                            | `pty-addon`            |   `75728` | `d2e7a2fd87b6c6ef9653230e776dc7569b19a5be8de2c0a53940f19c9246dd05` |
| `tree-sitter`      | `0.25.1` | `node_modules/tree-sitter/prebuilds/linux-x64/tree-sitter.node`           | `parser-runtime-addon` |  `679752` | `8bac0eef8899dd6e2feda111df061cb6bdbe92c0b3672ca3c7fe4df5cb176ea6` |
| `tree-sitter-bash` | `0.25.1` | `node_modules/tree-sitter-bash/prebuilds/linux-x64/tree-sitter-bash.node` | `bash-grammar-addon`   | `1382672` | `26573c48d8780349cb7e386328faba91e50833032ac06f5760cfca3568611d97` |

The inventory also verifies logical path, staged realpath, package metadata, file regularity, size,
digest, selected-winner policy, and that no unlisted native runtime file exists.

## Staged Runtime Host smoke

The mandatory staged Runtime smoke ran from the actual staged runtime using the staged
`desktop-server-launcher.cjs` under `ELECTRON_RUN_AS_NODE=1`, on a random loopback port. Its isolated
state covered Pi, context, settings, session, workspace, image, execution, automation, and terminal
history; inherited `NODE_*` startup settings were removed before controlled replacements were added.
No state path, token, port, pid, or process handle is recorded here.

The redacted success report completed in `878 ms` and established all of the following:

- an exact ready DTO, isolated `host.describe`, and empty initial `session.list` response;
- ordinary HTTP `GET /api/events.host` and `GET /api/events.mux` each returned `426 Upgrade
Required`, while an untrusted Host mux request returned `403 Forbidden`;
- Pi `events.host` opened and cleanly closed with `1000`; Pi mux received `{}` and closed with
  `1008`, reason `downlink only`;
- Terminal WebSocket completed the full `process/ready` contract, delivered monotonically increasing
  output, observed a split-frame marker, and closed `1000` after `exitCode: 0`, `reason: exited`,
  and `state: exited`;
- the terminal challenge was encoded as base64 input so its random plaintext was absent from PTY
  input/echo; `process/error` is a failure path; and
- IPC shutdown completed normally with process exit `0`.

The Terminal probe injects the build orchestrator Node executable only as a hermetic REPL child; the
separate staged Electron native smoke proves the selected Electron ABI, native modules, `node-pty`,
and platform shell path. Together they prove the release Host/Terminal gateway path without treating
the probe as an assertion about a user's default shell.

## Residuals carried forward

1. `node-pty`, `tree-sitter`, and `tree-sitter-bash` are source-owned by
   `@workbench/terminal-server`, but root compatibility declarations remain staging/rebuild inputs
   until a dedicated resolver-from-leaf-manifest cleanup gate passes.
2. Coordinated Execution/Automation shutdown remains application-lifecycle work.
3. Phase 3 must atomically move `server.ts`, Next Runtime API routes, and warmup ownership while
   retaining exactly one Host, Pi session registry, stream hub, and shutdown graph.
4. Desktop-sidecar auth policy has contract coverage, but production token generation, NDJSON control,
   bootstrap delivery, and Electron runtime supervision await the Runtime artifact/app phases.
5. Actual custom-protocol renderer-to-loopback HTTP/WebSocket Origin and Private/Local Network
   Access behavior remain a later Electron/Tauri static-renderer gate.
6. This is Linux-only real packaging and native execution. It is not macOS/Windows proof.
7. This gate did not run a clean-checkout `pnpm install --frozen-lockfile`; it must not be cited as
   frozen-install proof.
8. Shell product composition still retains the Next-aware Main View, product storage/settings,
   catalog policy, application context, Runtime feedback/error adapters, panels, command palette,
   header/sidebar/actions, and complete assembly outside the generic Shell leaf.
9. Phase 2 completion does not start or complete `apps/web`, `apps/runtime-node`,
   `apps/desktop-electron`, static renderer, or Tauri work.
