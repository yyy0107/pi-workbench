# Phase 9 Tauri sidecar parity evidence

Date: 2026-08-31
Revision: `77322072c64aa6a15d8ee8bf34927a91669db488`
Branch: `codex/agent-runtime-workspace-refactor`
Status: Linux exact-PGID spike closed — final Debian normal and running hard-death gates passed;
Windows and macOS packaged gates remain pending, and arbitrary descendant-tree containment is not
part of the selected Unix contract.

## Evidence discipline

This evidence was collected from the shared migration worktree. At the beginning of Phase 9 evidence
capture, `git status --porcelain=v1` reported 956 paths. No clean checkout, commit, stage, reset, or
stash was used to manufacture a smaller result. Generated `dist`, Cargo target, staged Runtime
resources, and sidecar binaries are ignored outputs and are not treated as source evidence.

Passing one containment scope does not imply another. Terms and platform gates follow
[`phase-9-tauri-sidecar-containment-adr.md`](./phase-9-tauri-sidecar-containment-adr.md).

## Runner and toolchain

| Field              | Value                         |
| ------------------ | ----------------------------- |
| OS                 | Linux 7.0.0-30-generic x86_64 |
| libc               | glibc 2.43                    |
| Node.js            | 24.16.0                       |
| pnpm               | 11.22.0                       |
| Rust               | rustc/cargo 1.96.0            |
| Tauri CLI          | 2.11.4                        |
| Tauri Rust crate   | 2.11.5                        |
| tauri-build        | 2.6.3                         |
| tauri-plugin-shell | 2.3.6                         |
| process-wrap       | 10.0.0                        |

This runner proves only the native Linux x64 glibc row. It does not substitute for Windows or macOS
package evidence.

## Bundled renderer and security boundary

The source boundary has one renderer-to-Rust command, `runtime_bootstrap`. The capability is local,
bound to the `diagnostics` window, and grants only the generated `allow-runtime-bootstrap`
permission. Production configuration has no `devUrl`, `remote.urls`, broad shell, filesystem, HTTP,
or general network-plugin permission. The CSP permits bundled assets and authenticated loopback
Runtime HTTP/WS only.

The final focused TypeScript gate passed 13 tests and covers:

- bundled-only renderer assets and exact Tauri configuration;
- exact bilingual `en-US` / `zh-CN` catalog shape;
- the single bootstrap bridge and declared package imports;
- link-free deterministic staging, rollback, and publication drift;
- static exclusion of Tauri app restart APIs.

The app TypeScript typecheck completed with no diagnostics.

## Shared Runtime control protocol

The shared owner is `@workbench/host-contracts`. The version-1 golden fixture contains canonical
input/output frames, UTF-8 and chunk-boundary cases, the exact 65,536-byte content limit, framing
failures, strict DTO negatives, and explicitly non-gating JavaScript/Rust compatibility exceptions.

Host-contracts focused tests passed 69 cases. Rust consumes the same fixture directly from the
package source in test builds; the fixture is not copied into release resources.

## Rust lifecycle and envelope gates

The existing full Rust gate passed 30 unit tests and 2 real app-binary watchdog integration tests.
It covered strict control decoding, renderer Origin validation, token redaction, startup
cancellation, ready PID identity, crash/protocol failures, shutdown ACK/exit ordering,
cross-language resource-envelope verification, and Unix parent-death containment. Clippy completed
for all targets with `-D warnings`, and `cargo fmt --check` passed. After the restart ordering unit
was added, its focused Rust gate passed 1/1; the full 30+2 Rust gate was green before that focused
addition and was not claimed as rerun afterward. The final focused TypeScript 13/13, app typecheck,
format, and lint gates also passed.

The Unix implementation self-executes the packaged Tauri binary in a private watchdog mode before
spawning the Host. It clears the watchdog environment, requires `pid == pgrp > 1`, emits one exact
READY frame, independently revalidates the PGID from the parent, marks the sole liveness writer
`FD_CLOEXEC`, and assigns the Host to the verified group through the standard command pre-exec
process-group API. Every startup error, cancellation, normal shutdown, forced shutdown, and restart
path reaps the Host/watchdog and proves `killpg(pgid, 0) == ESRCH` within one absolute deadline.
Unexpected watchdog health EOF is a sticky Runtime failure. Windows retains the JobObject path.

The scripted escaped-`setsid` negative separately proves the current exact-PGID boundary: it records
PID/PGID/SID/start identity, survives owner-alive PGID cleanup, and is then removed by an
identity-checked test-harness path. It is not counted as an orphan-cleanup pass.

These tests establish the implementation contract, but do not replace the final packaged
parent-death matrix below.

## Final Debian package and native Runtime envelope

The executed final package was
`apps/desktop-tauri/src-tauri/target/release/bundle/deb/Pi Workbench Diagnostics_0.1.0_amd64.deb`.
It was 71,715,796 bytes with SHA-256
`c07ca91b0292bf7143cc3637dc015140c76e00b1112e1658cf9293c1dbcab805`.

The Tauri staging owner invoked the Runtime artifact producer and materialized the admitted
artifact into a link-free resource tree. Extraction and remeasurement of the final Debian package
reported:

| Field                  | Value                                                              |
| ---------------------- | ------------------------------------------------------------------ |
| Runtime flavor         | Node.js                                                            |
| Platform / arch / libc | linux / x64 / glibc                                                |
| Target triple          | `x86_64-unknown-linux-gnu`                                         |
| Node.js                | 24.16.0                                                            |
| Node module ABI        | 137                                                                |
| N-API                  | 10                                                                 |
| Envelope SHA-256       | `93eb6aa257b7a78756e228eb3a0882445ae360cfff4f3b3731c6bbea9f8288ff` |
| Runtime files          | 10,157                                                             |
| Runtime directories    | 2,494                                                              |
| Runtime logical bytes  | 87,510,370                                                         |
| Runtime tree SHA-256   | `35fa7be0d9c2a3b416d67d1d18222c928415b2a576b22ffbe93353e3136951ca` |
| Symbolic links         | 0                                                                  |
| Native files           | 3                                                                  |

The tree digest uses `sha256-utf8-path-type-size-content-v1`: logical paths use `/`, records sort by
unsigned UTF-8 path bytes, and the envelope itself is excluded. Rust remeasures the final sidecar,
source manifest, and complete resource tree before spawning the Host. The staged tree contains no
symbolic links.

## Final-package execution

The normal final-package gate reached renderer `passed` and exercised two complete Runtime
generations. The first generation and port `32947` were empty before the second generation and port
`39681` were published. Cooperative window-close shutdown returned exit code 0 and left no owned
process or retained-port residue.

The hard-death final-package gate observed a published first-generation Host, listener, and live
real PTY before sending `SIGKILL` to the exact Tauri process. The watchdog then emptied its verified
exact PGID: selected-scope process residue was 0 and retained Runtime ports were 0. The unrelated
identity-checked decoy survived. The real PTY was outside the exact PGID and exited incidentally;
its disappearance is recorded as scope-out behavior, not as containment success.

The final package and harness output were also checked for token-bearing argv, environment, URL,
stdout, and stderr material. The bootstrap connection remains in memory and no credential leak was
reported by the executed gates.

The separate real-process escaped-`setsid` test remains the survivor negative: escaped descendants
are not covered by exact-PGID cleanup. This is the selected supported Unix contract; arbitrary
descendant-tree containment is unsupported rather than silently reported as passed.

## Remaining platform gates

The following items are intentionally not marked passed:

- Windows JobObject strict-tree native package evidence;
- macOS exact-PGID native package evidence and explicit strict-tree support decision;
- any future Linux delegated-cgroup strict-tree support, if the product later selects that stronger
  contract.

Phase 9 is closed for the executed Linux x64 glibc exact-PGID spike. This does not close the Windows
or macOS package rows and does not make the three-platform production matrix ready. Phase 10 now
owns static Desktop renderer and production-container convergence.
