# @workbench/pi-server-ports

src defines Host/tool preferences, extension UI, narrow session access and stream publication contracts. lib preserves the shared builtin-preference fallback, consumed by the server Host binding adapter. Both roots use TS and at most one subdirectory. Binding globals, session registries and StreamHub implementations stay in their composition owners. SDK objects are server-only and never wire payloads. Tests live in tests/.

Source layout: src owns this capability and its contracts; lib contains consumed internal helpers; tests live at the package root. Example consumer: `src/resource-preference.ts` imports `lib/read-builtin-preference.ts`. Capability and helper code remains TS/TSX; existing build tooling retains its language.

Browser and workspace-file ports use browser-contracts/host and agent-runtime-contracts/runtime-capabilities. Resource session snapshots belong to agent-runtime-contracts/workspace-catalog. This package has no dependency on browser adapters or workspace-server implementations.
