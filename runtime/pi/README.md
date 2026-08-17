# Workbench Pi runtime

This runtime hosts Pi directly inside the Workbench Next.js server. `pi-web` is a reference only;
the browser never calls it and the server does not proxy it.

## Session lifecycle

- The browser keeps one `PiClientSession` state object per opened conversation. Switching the
  active conversation does not destroy that state.
- Every Pi session can run independently, so work can continue in background conversations.
- A running session has its own SSE connection. After it becomes idle, only that connection is
  closed after a 30-second grace period; messages and runtime state remain resident.
- The server keeps live Pi `AgentSession` instances for 10 idle minutes. Persisted history can be
  read cold through `SessionManager` without starting an agent.
- A separate global SSE stream carries the set of running session IDs, allowing the sidebar to
  show running and background-completed state without opening every session event stream.

## Server configuration

- Persisted sessions are discovered across all Pi workspaces and grouped by their canonical `cwd`.
- There is no default workspace. Before a new conversation can be initialized, the user must pick
  a server-side directory. The server canonicalizes and validates that directory again when it
  creates the Pi session.
- The session list returns a stable workspace id derived from the canonical path, so every
  conversation remains nested under exactly one workspace.
- `PI_WORKBENCH_TRUST_PROJECT=1` opts into project-local Pi settings and extensions. They are not
  trusted by default.
