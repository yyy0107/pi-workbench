# Tauri sidecar containment ADR

Date: 2026-08-31
Status: Accepted; Linux exact-PGID final-package gate passed, Windows/macOS native promotion gates
remain open

## Decision scope

This ADR defines what the Tauri container owns when it starts a Runtime Host generation. It separates
four failure modes that must not be collapsed into one generic “orphan cleanup” claim:

1. **Cooperative cleanup** — the Runtime Host receives a control shutdown frame or control-stdin EOF
   and disposes its own graph.
2. **Owner-alive forced cleanup** — the Rust supervisor is still alive, the Host is not cooperating,
   and the supervisor invokes the platform force primitive within a bounded deadline.
3. **Container hard-death containment** — the Tauri process is killed or aborts and cannot run Rust
   destructors or an async shutdown path.
4. **Escaped descendant containment** — a descendant changes session/process group, as `setsid`,
   detached application processes, and real PTYs can do.

“Process tree,” “process group,” and “descendant tree” therefore have different meanings in evidence.
Passing one row never implies another row passed.

## Terms

- **Runtime generation**: one Host process, its token, instance ID, loopback port, platform
  containment owner, and the descendants created during that generation.
- **Exact-PGID contained**: the platform primitive covers processes that still belong to the exact,
  identity-verified Runtime generation process group when containment is triggered.
- **Strict descendant-tree contained**: descendants cannot escape the kernel containment merely by
  using ordinary child-process APIs, `setsid`, or `setpgid`.
- **Cooperatively cleaned**: the Host observed control shutdown/EOF and confirmed its own cleanup. It
  is not a synonym for hard-contained.
- **Runtime generation restart**: the old Host receives `shutdown` with reason `restart`; its selected
  containment scope and port are confirmed empty; only then may a new token, instance ID, port, and
  containment owner be published.

Runtime generation restart is not a Tauri application restart. Product and boundary tests forbid
`AppHandle::restart`, `request_restart`, and `RESTART_EXIT_CODE`. Tauri's restart exit path cannot be
made safe by relying on `ExitRequested::prevent_exit`.

## Current platform acceptance matrix

| Platform and scope              | Cooperative / owner-alive force                | Container hard-death                                                     | Escaped `setsid` / PTY                                                                        | Promotion status                                                                                                                  |
| ------------------------------- | ---------------------------------------------- | ------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Windows Runtime descendant tree | NDJSON shutdown plus JobObject force           | JobObject `KILL_ON_JOB_CLOSE` is the selected strict kernel primitive    | Job does not permit breakaway                                                                 | Static design accepted; real packaged native matrix required                                                                      |
| Linux exact Runtime PGID        | NDJSON shutdown plus exact process-group force | Self-exec liveness-pipe watchdog                                         | Not covered after escape                                                                      | Linux x64 glibc layered evidence and final-package running hard-death gate passed; other native targets remain platform-specific  |
| Linux arbitrary descendant tree | Host cleanup may succeed cooperatively         | Process group is insufficient                                            | Requires a correctly delegated per-generation cgroup v2 leaf and race-free pre-exec admission | Unsupported unless that cgroup contract is available; never silently fall back and report strict success                          |
| macOS exact Runtime PGID        | NDJSON shutdown plus exact process-group force | A self-exec liveness-pipe watchdog is required                           | Not covered after escape                                                                      | Implementation may be shared with Linux; native evidence remains platform-specific                                                |
| macOS arbitrary descendant tree | Host cleanup may succeed cooperatively         | No equivalent unprivileged kernel container exists in the selected stack | Real `node-pty` uses a new session                                                            | Unsupported by the current architecture; production support must narrow the contract or choose a different container architecture |

## Unix watchdog decision

The Tauri host uses a private self-exec watchdog and accepts it only as
**exact-runtime-process-group parent-death containment**.

The ordering is part of the contract:

1. The Tauri binary starts the watchdog mode before starting the Runtime Host.
2. The watchdog is the leader of a new process group and verifies that its positive PID equals its
   PGID. A manually invoked non-leader must fail without signaling any process group.
3. The parent retains the only liveness writer. The watchdog emits an exact identity-ready frame,
   then blocks on liveness EOF. It has no disarm command.
4. Only after the watchdog is armed does the parent start the Runtime Host in the watchdog's exact
   PGID. The Runtime executable must not inherit the liveness writer across `exec`.
5. Liveness EOF makes the watchdog send `SIGKILL` to its already verified positive PGID, including
   itself.
6. While the Rust owner is alive, startup errors, control failures, shutdown timeouts, and restart all
   use the same exact group owner and bounded waits. Unexpected watchdog-health EOF is a sticky
   Runtime failure.

The Runtime child must not use `process-wrap`'s `ProcessGroup::attach_to` as its active wrapper:
process-wrap 10 records the child PID as the wrapper PGID after spawn. The implementation instead
uses the standard Unix command pre-exec process-group assignment, while the watchdog retains the
leader/group handle.

## Why the Unix watchdog is not strict-tree containment

A process group is intentionally escapable. A descendant can create a new session/process group;
`node-pty` and detached application processes are real examples in this repository. Once escaped,
`killpg` cannot reach it.

For that reason, Phase 9 must keep an escaped-child negative test:

- record PID, PPID, PGID, SID, and start identity;
- create a descendant with `setsid` that ignores `TERM` and `HUP`;
- prove exact-PGID cleanup does not signal it;
- use the recorded identity to clean it from the test harness;
- never count this negative as an orphan-cleanup pass.

Linux strict-tree containment may later use a delegated cgroup v2 leaf. Such a path is valid only if
the Runtime enters the leaf without a child-before-move race, `cgroup.kill` is available, and
`cgroup.events` confirms `populated=0`. A normal desktop process cannot assume that a writable
delegated subtree exists. macOS has no corresponding unprivileged primitive in the current stack.

## Native acceptance gates

Unit/scripted tests establish protocol, failure ordering, and construction-equivalent timing stages.
Final-package evidence remains required for risks that depend on the staged Node/native envelope or
the composed application process graph; equivalent timing points do not require duplicate packaged
end-to-end runs when liveness ownership and group membership are unchanged.

### Common gates

- record exact Tauri, watchdog/container, Host, ordinary grandchild, and PTY identities;
- record PID, start identity, PGID, and SID where the platform exposes them;
- preserve an unrelated decoy and prove cleanup does not signal it;
- verify the final staged Node target triple, Node version, module ABI, N-API version, and envelope
  hash before launch;
- verify token absence from argv, environment, URLs, stdout, stderr, and diagnostics;
- verify old Host, selected containment owner, selected containment scope, and old port are gone
  before publishing a restarted generation.

### Windows strict-tree gate

Terminate the exact packaged Tauri process at multiple lifecycle stages. The Host, ordinary
grandchild, and real PTY must disappear through the JobObject while the decoy remains. A breakaway
attempt must not weaken the job. This row cannot be marked passed on a Linux runner.

### Unix exact-PGID gate

The hard-death gate uses layered equivalent evidence rather than six duplicate packaged kills:

- before watchdog-ready, there is either no Runtime child or only the self-exec watchdog; parent
  death closes its sole liveness writer, and a READY write failure or subsequent EOF takes the same
  verified exact-PGID kill path;
- between watchdog-ready and Runtime spawn, the verified PGID contains only the watchdog, which is
  covered by the real application-binary READY/EOF integration test;
- before Host ready, process-group membership was already fixed by the Host's pre-exec assignment;
  startup cancellation, timeout, crash, PID, and protocol tests cover cleanup before publication;
- around shutdown acknowledgement, liveness ownership does not change: the parent retains the
  writer until after acknowledgement, Host stdin closure, and Host exit, and only then terminates
  the watchdog and proves the group empty;
- a restart gap is valid only after the old Host, containment owner, exact PGID, and port are empty
  and before a new generation is published. That publication ordering is a separate normal
  packaged restart gate, not another hard-death containment case.

The final Debian package therefore requires one hard-death run while a published Runtime Host,
listener, and real PTY are active. Kill the exact packaged Tauri process and prove that the
watchdog, Host, every observed same-PGID member, and old port disappear while an unrelated decoy
remains. This composed run, together with the construction and real-binary tests above, covers the
exact-PGID parent-death contract without treating equivalent timing points as independent evidence.

The final Debian normal and running hard-death evidence passed on Linux x64 glibc. Exact package
hashes and measurements remain available in repository history.

### Real PTY gate

Create an actual `node-pty` session through the Runtime Host and record its PID/PPID/PGID/SID.
Normal/cooperative shutdown must clean it. Hard-death evidence must report whether it remains inside
the selected containment scope; it may not infer this from a synthetic ordinary child. If the real
packaged PTY is outside the selected PGID and exits incidentally after Host or Tauri death, record
that outcome as scope-out and do not count its disappearance as containment. The separate
real-process `setsid` test, whose escaped identity survives HUP, TERM, and exact-PGID cleanup until
identity-checked harness cleanup, is the survivor negative for this boundary.

## Phase 10 and Phase 11 promotion

Phase 9 closes only the platform rows actually executed. A Linux exact-PGID spike does not close
Windows, macOS, or strict descendant-tree rows.

Before Phase 10 is called production-ready, the Unix strict-tree gap must resolve to one explicit
choice per supported platform:

- implement and require a kernel container such as delegated cgroup v2;
- narrow the supported hard-death contract and expose the limitation in product/release policy; or
- mark the platform unsupported.

Phase 11 release closeout requires the selected platform's layered hard-death evidence, including
the final-package composed running gate, in addition to ordinary protocol, UI, native module,
shutdown, and restart smoke.

## References

- [`apps/desktop-tauri/src-tauri/src/runtime_supervisor.rs`](../apps/desktop-tauri/src-tauri/src/runtime_supervisor.rs)
- [`apps/desktop-tauri/src-tauri/test-fixtures/runtime-supervisor-child.mjs`](../apps/desktop-tauri/src-tauri/test-fixtures/runtime-supervisor-child.mjs)
- [Linux kernel cgroup v2 documentation](https://docs.kernel.org/admin-guide/cgroup-v2.html)
- [process-wrap 10.0.0](https://crates.io/crates/process-wrap/10.0.0)
- [Tauri sidecar documentation](https://v2.tauri.app/develop/sidecar/)
