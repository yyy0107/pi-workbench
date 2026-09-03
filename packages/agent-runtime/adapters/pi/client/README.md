# `@workbench/agent-runtime-pi-client`

Browser-side Pi adapter for the Workbench agent-runtime interfaces.

## State ownership

Each `PiClientSession` is the only mutable owner of one session's history, live stream, optimistic
messages, reconnect state, queue, interactions, and run state. History, live, and optimistic inputs
share one normalized `PiConversationMessage` sequence:

```text
Pi transport events / history
  -> PiClientSession
  -> PiConversationAssembler
  -> Workbench ConversationSession + Snapshot + per-node observables
  `-> assistant-ui compatibility messages
```

The assistant-ui output is a temporary, read-only projection from the same session state. It does
not own a second reducer, stream subscription, or message store.

`PiSessionManager` implements the Headless `AgentRuntime` face by projecting its existing catalog,
selection, and session cache through stable observables. `PiAgentRuntimeProvider` installs that same
manager into both `RuntimeProvider` and the temporary assistant-ui Host, so the transition does not
create another manager, session, transport, or connection.

## Internal boundaries

- `transport/` owns RPC/WebSocket carriers, stream generations, watermarks, and gap detection; it
  owns no conversation or UI state.
- `runtime/manager.ts` owns the session catalog, selection, metadata, session cache, Headless Runtime
  projection, and frame routing. It does not fold conversation messages.
- `runtime/session.ts` owns one session's state and supported action capabilities and publishes both
  projections.
- `conversation/` owns the canonical Pi message shape, stable Workbench Node/Block projection,
  structure sharing, publication priority, and per-node observables.
- `assistant-ui/` contains only the current compatibility and installation boundary; its Provider
  also mounts the Headless Runtime binding over the same manager.

Unchanged Node and Block references remain stable. Ordinary state publishes in a microtask,
streaming deltas at the current animation-frame boundary, and terminal state immediately.

## Public boundary

Consumers must import one of the explicit feature subpaths. The package intentionally exposes no
root barrel, raw RPC transport, session-manager class, or manager React context. Cross-layer imports
point directly to their owning module instead of using `runtime/manager.ts` as an internal barrel.
