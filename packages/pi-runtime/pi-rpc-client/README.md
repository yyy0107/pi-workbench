# @workbench/pi-rpc-client

src owns Pi RPC/HTTP operations, installation transport snapshots and paired WebSocket generation/reconnect/watermark control. lib parses and validates stream frames before connections.ts dispatches them. Both use TS with shallow roots. Message materialization is consumed from pi-conversation/accumulator, never duplicated. Public API tests combining client invalidation stay in pi/client/tests/transport; this package tests the connection behavior.

Source layout: src owns this capability and its contracts; lib contains consumed internal helpers; tests live at the package root. Example consumer: `src/connections.ts` imports `lib/stream-frame-parser.ts`. Capability and helper code remains TS/TSX; existing build tooling retains its language.
