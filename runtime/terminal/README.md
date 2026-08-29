# Workbench Terminal Runtime

The Terminal extension exposes a real pseudoterminal inside RightWorkspace:

```text
React Workspace Surface
  -> xterm.js
  -> bidirectional WebSocket (/api/terminal)
  -> TerminalGateway
  -> TerminalSessionManager / ToolTerminalSessionManager
  -> persistent process handle
  -> node-pty (tty=true)
  -> bash / zsh / fish / claude / codex
```

`TerminalGateway` shares the custom Workbench HTTP server and receives the common
Host/Origin/cross-site trust inspector from the top-level server composition root. Terminal remains
independent of Pi server modules while applying the same trust fence as the Pi RPC and stream
endpoints. It validates bounded JSON frames before forwarding input, resize, or interrupt messages
to the PTY. Ordinary HTTP access to the path returns `426 Upgrade Required`.

The wire contract treats a terminal as a first-class process rather than a one-shot shell response.
Every connection begins with a complete `process/ready` snapshot containing a stable
`processHandle`, process/interaction/attachment states, PTY identity, start time, and output limits.
Raw terminal chunks are ordered `process/output-delta` events; stdin, resize, interrupt, and
termination requests must carry the same handle. `process/exited` is the authoritative terminal
lifecycle event and distinguishes normal exit from abort, timeout, or explicit termination.

`TerminalSessionManager` owns one PTY process per terminal instance id. Every New terminal action allocates
a fresh id and PTY, so one conversation can keep multiple independent terminals open at once. The
RightWorkspace surface and PTY id both carry the assistant-ui conversation id; terminal tabs are
thread-scoped and are restored only for that conversation. The manager canonicalizes the working
directory, rejects an instance id reused for another directory, keeps ordered output deltas and up
to 1 MiB of output for reconnect replay, reports when that replay cap rolls, limits the process to
32 concurrent sessions, and releases an unattached PTY after ten minutes. Closing a Workspace tab
changes attachment state without killing the shell, so reopening that process resumes it.

Workbench registers `createWorkbenchBashToolOverride` as a custom tool named `bash`. Pi registers
built-ins first and then replaces matching names with custom/extension definitions, so this
definition deliberately overrides Pi's built-in `bash` without patching the Pi package or changing
Pi itself. The override reuses Pi's standard Bash definition, preserving its command and timeout
parameters, output accumulation, timeout, truncation, renderer, and tool-result behavior. It extends
the model-visible schema with an optional discriminated `input` field and replaces the execution
operations with `ToolTerminalSessionManager`.

The `input` field makes stdin ownership an Agent decision instead of a renderer heuristic. The Agent
omits it for commands that do not read stdin. For safe, deterministic answers it sends
`{ source: "agent", data }`; Workbench writes the exact bounded data to the PTY immediately after
startup, including any newlines supplied by the Agent. For secrets, user preferences, ambiguous
choices, or prompts the Agent cannot reliably predict, it sends `{ source: "user" }`; the
conversation waits for the matching tool PTY to become writable, then expands the Bash card and
reveals that live terminal. A user-owned declaration never contains the input value in tool
arguments.

`ToolTerminalSessionManager.spawn()` registers and returns a stable process handle immediately;
the Pi adapter separately awaits its `completion`. Output events, stdin, resize, interrupt,
termination, timeout, reconnect replay, and final exit all continue to address the same process.
The session can therefore outlive any individual WebSocket attachment while the original Pi tool
call remains the owner of its completion.

Before execution, `BashCommandPolicy` parses the model command with the Tree-sitter Bash grammar and
creates a PTY execution plan. It removes only high-confidence redundant Runtime work: a literal
temporary `.log` redirected from the primary command and read back only by `cat`, finite
`head`/`tail`, or an equivalent single `tee`; an output-limiting pipeline followed by explicit exit
readback; and a detached `script` recorder whose remaining commands only poll/read its temporary
transcript or inspect the spawned process. The detached form may be wrapped by `setsid` and may have
narrowly validated cleanup/status scaffolding around it; the nested command still returns to the
Workbench-owned foreground PTY. The same rule applies to a detached `tmux new-session` when every
remaining statement only waits for or inspects that temporary session; standalone/background-service
tmux commands keep their original semantics. A simple `timeout` inside those wrappers is lifted into
the process timeout instead of remaining a child shell. Parse failures, dynamic paths, ordinary
redirects, append redirects, follow mode, business pipelines, background services, and ambiguous
constructs execute unchanged.

The RightWorkspace xterm receives the untouched raw PTY stream and can write to that process's
stdin. Pi and the conversation card receive a separate append-only transcript projection: its
stateful ANSI decoder handles control sequences split across chunks, buffers the current terminal
line, coalesces carriage-return redraws such as spinners into their final stable line, applies
backspaces, and flushes a final unterminated prompt when the process exits. This keeps full terminal
fidelity for the user without filling the model result with repeated TUI frames.

`TerminalInteractionDetector` remains a presentation hint inside an attached terminal, not an
execution or disclosure primitive. A running tool moves from `none` to `possible` only after
multiple TUI signals (cursor control, erase, alternate-screen, or redraw behavior), or a
high-confidence unterminated text prompt such as a confirmation, password, passphrase, or
press-enter request, is followed by a quiet period. Silence without evidence does not qualify.
Input written through the attached terminal moves it to `active`; resumed substantive output
settles it back to `none`. Process exit also returns it to `none`. These observed states may refine
status text after the terminal is open, but they never decide whether to open it; only the Bash
tool's declared `input.source` does.

Opening or closing the tool terminal only attaches or detaches a viewer. Clicking its stop control
sends an explicit `process/terminate` request, terminates the shared PTY, and completes the original
Pi tool call as aborted. `process/interrupt` remains a distinct Ctrl-C operation. Completed tool
terminals retain bounded output briefly for replay; tool calls from
before the server acquired their PTY fall back to the conversation's stored output and remain
read-only.

The default program is `$WORKBENCH_TERMINAL_SHELL`, then `$SHELL`, then the platform default
(`/bin/bash` or `powershell.exe`). Interactive programs such as `claude` and `codex` run inside the
same PTY when launched from that shell. Tool commands choose their invocation arguments from the
resolved executable: POSIX shells use login-command mode, PowerShell uses its command flags, and
`cmd.exe` uses `/d /s /c`. Unknown executables retain the platform default argument behavior. Bash
tool timeouts use Pi's finite, positive, Node-timer-bounded validation before a PTY is allocated.

This is a privileged local terminal, not a sandbox. The server is loopback-only by default. If the
Workbench is exposed through `PI_WORKBENCH_TRUSTED_HOSTS`, the outer deployment must provide
authentication and TLS as described in `runtime/pi/README.md`.
