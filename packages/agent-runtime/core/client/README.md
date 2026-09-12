# `@workbench/agent-runtime-client`

The browser-side React integration layer for Workbench. This package connects React UI to the
React-free Headless Agent Runtime and is intentionally independent of any concrete Agent Runtime
implementation.

## Responsibilities

This package is responsible for:

- Installing a stable `AgentRuntime` through `RuntimeProvider`.
- Binding the current Session, or an explicitly selected nested Session, through `SessionProvider`.
- Subscribing to thread lists, the current session, Conversation Snapshots, and message nodes with
  `useSyncExternalStore`.
- Providing selector hooks so updates to unselected message content do not cause unnecessary React
  rerenders.
- Exposing Runtime-neutral commands, thread stores, workspace search, and optional capabilities.
- Providing shared Workbench handling for capability errors, browser storage, Composer attachments,
  tool events, and message statistics.
- Defining the composition boundaries for workspace selection, Runtime installation, and nested
  session binding.

`AgentRuntime.current` exposes two identities:

- `sessionId`: the stable in-memory Session identity used to bind message state.
- `threadId`: the durable identity that exists after a local conversation is promoted, used for
  routing, catalog operations, and thread mutations.

A local draft can be created and selected without allocating a remote conversation. Thread catalog
mutations go through `threadActions` or the corresponding thread capability.

## Directory structure

```text
src/
  runtime/
    context.tsx              # AgentRuntime / ConversationSession React Context
    provider.tsx             # RuntimeProvider
    session-provider.tsx     # SessionProvider
    hooks.ts                 # Runtime, Session, Thread, and Node selector hooks
    snapshot-selector.ts     # useSyncExternalStore selector binding
    node-selection.ts        # Multiple conversation-node derived observable

  environment/
    context.tsx              # Runtime environment Context and capability hooks
    ports.ts                 # Thread store and workspace-file-search ports
    capabilities.ts          # Optional capabilities and stable error type
    installation.tsx         # Selected Runtime installation boundary

  workspace/
    selection.tsx            # Workspace selection Context and directory port

  browser/
    storage.ts               # localStorage with in-memory fallback
    composer-attachment.ts   # File to Composer attachment conversion

  conversation/
    tool-events.ts           # Tool payload helpers and completed-call hook
    prompt-feedback.ts       # Prompt feedback port and compatibility framing
    thread-list-reload.ts    # Coalesced thread-list reload coordinator
    statistics.ts            # Message/node statistics aggregation
    presentation-metadata.ts # Generic reasoning and parallel-tool metadata

  index.ts                   # Main public entry point
```

## Public entries

Public subpaths are defined by the `exports` field in `package.json`. Consumers should use package
imports instead of depending on internal files under `src`:

| Entry | Purpose |
| --- | --- |
| `@workbench/agent-runtime-client` | Providers, selector hooks, storage, Composer, and generic tool helpers |
| `@workbench/agent-runtime-client/environment` | Runtime ports such as the thread store and workspace-file search |
| `@workbench/agent-runtime-client/context` | Runtime environment Provider and capability hooks |
| `@workbench/agent-runtime-client/capabilities` | Optional capability contracts and `WorkbenchAgentCapabilityError` |
| `@workbench/agent-runtime-client/installation` | Runtime installation contract used by the application composition root |
| `@workbench/agent-runtime-client/message-statistics` | Statistics aggregated from Headless Nodes and Blocks |
| `@workbench/agent-runtime-client/message-presentation-metadata` | Reasoning and parallel-tool presentation metadata |
| `@workbench/agent-runtime-client/prompt-feedback` | Narrow workspace prompt-feedback interface |
| `@workbench/agent-runtime-client/workspaces` | Workspace selection and directory-store port |

Example:

```tsx
import {
  RuntimeProvider,
  SessionProvider,
  useCurrentSession,
  useSessionState,
  useThreadList,
} from "@workbench/agent-runtime-client";
import {
  WorkbenchAgentRuntimeEnvironmentProvider,
  useWorkbenchWorkspaceCapability,
} from "@workbench/agent-runtime-client/context";
```

## Boundaries

This package does not own:

- A concrete Agent protocol, Pi SDK, or network transport.
- A concrete Runtime manager, adapter, or transport lifecycle.
- Server-side command, execution, or thread-port implementations.
- The visual Sidebar, Composer, Message, or other Workbench Shell components.
- The concrete Zustand, Redux, or other state-management implementation for workspaces.

A concrete Runtime should implement its transport, manager, and adapter in its own package, then map
them to this package's `AgentRuntime`, `ConversationSession`, thread ports, and capabilities. Generic
Workbench UI should consume only stable Workbench DTOs, error codes, and capability interfaces; it
should not branch on Runtime IDs.

`RuntimeProvider` and `SessionProvider` bind the Runtime and Session objects to React.
`WorkbenchAgentRuntimeEnvironmentProvider` binds commands, the thread store, workspace search, and
optional capabilities to the selected Runtime environment. When an optional capability is absent,
its hook returns `undefined`, allowing the UI to hide the entry point or show an explicit unavailable
state.

## Development checks

Run these commands from the repository root:

```bash
pnpm --filter @workbench/agent-runtime-client typecheck
pnpm --filter @workbench/agent-runtime-client test
```

The package should preserve its dependency boundaries: production sources must not import a concrete
Agent Runtime, and Runtime-neutral thread presentation and Composer consumers must remain independent
of any concrete implementation.
