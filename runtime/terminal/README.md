# Workbench Terminal Runtime

The Terminal extension exposes a real pseudoterminal inside RightWorkspace:

```text
React Workspace Surface
  -> xterm.js
  -> bidirectional WebSocket (/api/terminal)
  -> TerminalGateway
  -> TerminalSessionManager / ToolTerminalSessionManager
  -> node-pty
  -> bash / zsh / fish / claude / codex
```

`TerminalGateway` shares the custom Workbench HTTP server and the same Host/Origin/cross-site
trust fence as the Pi RPC and stream endpoints. It validates bounded JSON frames before forwarding
input, resize, or interrupt messages to the PTY. Ordinary HTTP access to the path
returns `426 Upgrade Required`.

`TerminalSessionManager` owns one PTY per terminal instance id. Every New terminal action allocates
a fresh id and PTY, so one conversation can keep multiple independent terminals open at once. The
RightWorkspace surface and PTY id both carry the assistant-ui conversation id; terminal tabs are
thread-scoped and are restored only for that conversation. The manager canonicalizes the working
directory, rejects an instance id reused for another directory, keeps up to 1 MiB of output for
reconnect replay, limits the process to 32 concurrent sessions, and releases an unattached PTY
after ten minutes. Closing a Workspace tab detaches the browser without immediately killing the
shell, so reopening that terminal instance resumes it.

Pi's built-in `bash` definition is wrapped by `createInteractiveBashTool`. The wrapper preserves
Pi's normal output accumulation, timeout, truncation, and tool-result behavior, but executes each
tool call through `ToolTerminalSessionManager` and addresses it by Pi session id plus tool call id.
The conversation card receives the same process output with terminal control sequences removed;
the RightWorkspace xterm receives the raw PTY stream and can write to that process's stdin. This
allows prompts, password input, full-screen terminal programs, and other interactive commands to
continue in the workspace terminal.

Opening or closing the tool terminal only attaches or detaches a viewer. Clicking its stop control
sends an explicit `interrupt` frame, terminates the shared PTY, and completes the original Pi tool
call as aborted. Completed tool terminals retain bounded output briefly for replay; tool calls from
before the server acquired their PTY fall back to the conversation's stored output and remain
read-only.

The default program is `$WORKBENCH_TERMINAL_SHELL`, then `$SHELL`, then the platform default
(`/bin/bash` or `powershell.exe`). Interactive programs such as `claude` and `codex` run inside the
same PTY when launched from that shell.

This is a privileged local terminal, not a sandbox. The server is loopback-only by default. If the
Workbench is exposed through `PI_WORKBENCH_TRUSTED_HOSTS`, the outer deployment must provide
authentication and TLS as described in `runtime/pi/README.md`.
