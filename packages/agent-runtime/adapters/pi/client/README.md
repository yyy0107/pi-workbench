# `@workbench/agent-runtime-pi-client`

Browser-side Pi adapter for the Workbench agent-runtime interfaces. The package owns Pi session
state, transport connections, assistant-ui projection, and feature-scoped client facades.

Consumers must import one of the explicit feature subpaths. The package intentionally exposes no
root barrel, raw RPC transport, session-manager class, or manager React context.
